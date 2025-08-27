import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rateLimit, RATE_LIMIT_CONFIGS } from '@/lib/rateLimit'

// POST /api/notes/[id]/fetch - Burn and fetch note (atomic operation)
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Apply rate limiting to reduce brute force attempts on note IDs
  const rateLimitResult = await rateLimit(request, RATE_LIMIT_CONFIGS.noteFetch)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { 
        error: 'Rate limit exceeded',
        remaining: rateLimitResult.remaining,
        resetTime: rateLimitResult.resetTime
      },
      { 
        status: 429,
        headers: {
          'Retry-After': '60'
        }
      }
    )
  }

  try {
    const { id } = params

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Invalid note ID format' },
        { status: 400 }
      )
    }

    // Use the atomic burn_and_fetch_note function
    const { data, error } = await supabaseAdmin.rpc('burn_and_fetch_note', {
      target_id: id
    })

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      )
    }

    // Check if note was found and had views remaining
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Note not found, expired, or already viewed' },
        { status: 404 }
      )
    }

    const row = data[0]
    const response = NextResponse.json({
      ciphertext: row.ciphertext,
      iv: row.iv_b64u
    })
    // Prevent caching of sensitive ciphertext data
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
