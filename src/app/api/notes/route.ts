import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rateLimit, addRateLimitHeaders, RATE_LIMIT_CONFIGS } from '@/lib/rateLimit'

// POST /api/notes - Create a new note
export async function POST(request: Request) {
  // Apply rate limiting
  const rateLimitResult = await rateLimit(request, RATE_LIMIT_CONFIGS.createNote)
  if (!rateLimitResult.success) {
    return new NextResponse(
      JSON.stringify({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': RATE_LIMIT_CONFIGS.createNote.maxRequests.toString(),
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': Math.ceil(rateLimitResult.resetTime / 1000).toString(),
          'Retry-After': Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString()
        }
      }
    )
  }

  try {
    const body = await request.json()
    const { 
      ciphertext, 
      iv_b64u, 
      expiresInSeconds = 86400, 
      views = 1, 
      pass_salt_b64u = null, 
      kdf_iters = null,
      passphrase_hash = null,
      validation_salt_b64u = null
    } = body

    // Validate required fields
    if (!ciphertext || !iv_b64u) {
      return NextResponse.json(
        { error: 'Missing required fields: ciphertext, iv_b64u' }, 
        { status: 400 }
      )
    }

    // Limit expiration to max 60 days
    const maxExpiration = 60 * 24 * 3600 // 60 days in seconds
    const limitedExpiration = Math.min(expiresInSeconds, maxExpiration)
    const expires_at = new Date(Date.now() + limitedExpiration * 1000).toISOString()

    // Validate views count
    if (views < 1 || views > 100) {
      return NextResponse.json(
        { error: 'Views must be between 1 and 100' },
        { status: 400 }
      )
    }

    // Insert note into database
    const { data, error } = await supabaseAdmin
      .from('notes')
      .insert({
        ciphertext,
        iv_b64u,
        expires_at,
        views_left: views,
        pass_salt_b64u,
        kdf_iters,
        passphrase_hash,
        validation_salt_b64u
      })
      .select('id')
      .single()

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Failed to create note' }, 
        { status: 500 }
      )
    }

    const response = NextResponse.json({ id: data.id })
    return addRateLimitHeaders(response, rateLimitResult, RATE_LIMIT_CONFIGS.createNote)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}
