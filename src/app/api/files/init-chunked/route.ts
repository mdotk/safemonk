import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rateLimit, RATE_LIMIT_CONFIGS } from '@/lib/rateLimit'

// POST /api/files/init-chunked - Initialize a chunked file upload
export async function POST(request: Request) {
  // Apply rate limiting for chunked upload initialization
  const rateLimitResult = await rateLimit(request, RATE_LIMIT_CONFIGS.initChunkedUpload)
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
    const body = await request.json()
    const { 
      file_name, 
      file_size,
      chunk_bytes,
      total_chunks,
      expires_at, 
      pass_salt_b64u = null, 
      kdf_iters = null,
      encrypted_filename = null,
      filename_iv = null,
      passphrase_hash = null,
      validation_salt_b64u = null
    } = body

    // Validate required metadata
    if (!file_name || !file_size || !chunk_bytes || !total_chunks || !expires_at) {
      return NextResponse.json(
        { error: 'Missing required metadata: file_name, file_size, chunk_bytes, total_chunks, expires_at' },
        { status: 400 }
      )
    }

    // Validate file size limits
    const maxSize = 500 * 1024 * 1024 // 500MB
    if (file_size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum file size is 500MB.' },
        { status: 413 }
      )
    }

    // Validate chunk size limits (1MB to 4MB to stay under platform limits)
    const minChunkSize = 1024 * 1024 // 1MB
    const maxChunkSize = 4 * 1024 * 1024 // 4MB (safe for most platforms including Vercel)
    if (chunk_bytes < minChunkSize || chunk_bytes > maxChunkSize) {
      return NextResponse.json(
        { error: 'Chunk size must be between 1MB and 4MB.' },
        { status: 400 }
      )
    }

    // Create file record in database
    const { data, error: dbError } = await supabaseAdmin
      .from('files')
      .insert({
        file_name,
        size_bytes: file_size,
        chunk_bytes, // Use actual chunk size from client
        total_chunks,
        iv_base_b64u: '', // Will be set by first chunk
        storage_path: '', // Will be updated immediately after creation
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
      return NextResponse.json(
        { error: 'Failed to create file record' },
        { status: 500 }
      )
    }

    // Update the storage_path with the file ID (used as directory path for chunks)
    const { error: updateError } = await supabaseAdmin
      .from('files')
      .update({ storage_path: data.id })
      .eq('id', data.id)

    if (updateError) {
      // This is a non-critical error for the user, but should be logged.
      // The cleanup script has a fallback, but this indicates a potential issue.
      console.error(`Failed to update storage_path for file ID ${data.id}:`, updateError)
    }

    return NextResponse.json({ 
      id: data.id,
      message: 'Chunked upload initialized' 
    })
  } catch (error) {
    console.error('Init chunked upload error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
