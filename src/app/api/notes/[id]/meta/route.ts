import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rateLimit, RATE_LIMIT_CONFIGS } from '@/lib/rateLimit'

// GET /api/notes/[id]/meta - Get note metadata without burning a view
export async function GET(
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

    // Use the get_note_complete_meta function to get both validation and encryption metadata
    const { data, error } = await supabaseAdmin.rpc('get_note_complete_meta', {
      target_id: id
    })

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      )
    }

    // Check if note was found
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Note not found or expired' },
        { status: 404 }
      )
    }

    const row = data[0]
    const response = NextResponse.json({
      validation_salt_b64u: row.validation_salt_b64u,
      pass_salt_b64u: row.pass_salt_b64u,
      kdf_iters: row.kdf_iters
    })
    // Prevent caching of sensitive metadata
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
