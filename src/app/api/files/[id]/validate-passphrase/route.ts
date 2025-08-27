import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rateLimit, RATE_LIMIT_CONFIGS } from '@/lib/rateLimit'

// POST /api/files/[id]/validate-passphrase - Validate passphrase without consuming download token
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Apply rate limiting to reduce brute force attempts
  const rateLimitResult = await rateLimit(request, RATE_LIMIT_CONFIGS.fileDownload)
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

    if (!id) {
      return NextResponse.json(
        { error: 'File ID is required' },
        { status: 400 }
      )
    }

    // Get passphrase hash from request body
    const body = await request.json()
    const { passphraseHash } = body

    if (!passphraseHash) {
      return NextResponse.json(
        { error: 'Passphrase hash is required' },
        { status: 400 }
      )
    }

    // Validate passphrase using database function
    const { data, error } = await supabaseAdmin.rpc('validate_file_passphrase', {
      target_id: id,
      provided_hash: passphraseHash
    })

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      )
    }

    // Return validation result
    return NextResponse.json({
      valid: data === true
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}