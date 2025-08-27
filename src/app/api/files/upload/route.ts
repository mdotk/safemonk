import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rateLimit, addRateLimitHeaders, RATE_LIMIT_CONFIGS } from '@/lib/rateLimit'

// POST /api/files/upload - Upload encrypted whole file
export async function POST(request: Request) {
  // Apply rate limiting
  const rateLimitResult = await rateLimit(request, RATE_LIMIT_CONFIGS.uploadFile)
  if (!rateLimitResult.success) {
    return new NextResponse(
      JSON.stringify({
        error: 'Rate limit exceeded',
        message: 'Too many file uploads. Please try again later.',
        retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': RATE_LIMIT_CONFIGS.uploadFile.maxRequests.toString(),
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': Math.ceil(rateLimitResult.resetTime / 1000).toString(),
          'Retry-After': Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString()
        }
      }
    )
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const metaString = formData.get('meta') as string

    if (!file || !metaString) {
      return NextResponse.json(
        { error: 'Missing file or metadata' },
        { status: 400 }
      )
    }

    const meta = JSON.parse(metaString)
    const { 
      file_name, 
      iv_base_b64u, 
      expires_at, 
      pass_salt_b64u = null, 
      kdf_iters = null,
      encrypted_filename = null,
      filename_iv = null,
      passphrase_hash = null,
      validation_salt_b64u = null
    } = meta

    // Validate required metadata
    if (!file_name || !iv_base_b64u || !expires_at) {
      return NextResponse.json(
        { error: 'Missing required metadata: file_name, iv_base_b64u, expires_at' },
        { status: 400 }
      )
    }

    // Limit file size to 500MB total, use chunked upload for files over 100MB
    const maxSize = 500 * 1024 * 1024 // 500MB total limit
    const chunkThreshold = 100 * 1024 * 1024 // 100MB threshold for chunking
    
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum file size is 500MB.' },
        { status: 413 }
      )
    }
    
    if (file.size > chunkThreshold) {
      return NextResponse.json(
        { error: 'File too large for whole upload. Use chunked upload for files over 100MB.' },
        { status: 413 }
      )
    }

    // Generate unique storage path
    const storagePath = `${crypto.randomUUID()}.bin`

    // Upload encrypted file to Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('secrets')
      .upload(storagePath, file, {
        contentType: 'application/octet-stream',
        upsert: false
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload file' },
        { status: 500 }
      )
    }

    // Store file metadata in database
    const { data, error: dbError } = await supabaseAdmin
      .from('files')
      .insert({
        file_name,
        size_bytes: file.size,
        chunk_bytes: file.size, // whole file = single chunk
        total_chunks: 1,
        iv_base_b64u,
        storage_path: storagePath,
        expires_at,
        pass_salt_b64u,
        kdf_iters,
        encrypted_filename,
        filename_iv,
        passphrase_hash,
        validation_salt_b64u
      })
      .select('id')
      .single()

    if (dbError) {
      console.error('Database error:', dbError)
      // Clean up uploaded file if database insert fails
      await supabaseAdmin.storage.from('secrets').remove([storagePath])
      return NextResponse.json(
        { error: 'Failed to store file metadata' },
        { status: 500 }
      )
    }

    const response = NextResponse.json({
      id: data.id,
      storagePath
    })
    return addRateLimitHeaders(response, rateLimitResult, RATE_LIMIT_CONFIGS.uploadFile)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
