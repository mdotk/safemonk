import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rateLimit, RATE_LIMIT_CONFIGS } from '@/lib/rateLimit'

// Configure route to handle larger request bodies for chunk uploads
export const runtime = 'nodejs'
export const maxDuration = 30 // 30 seconds timeout for chunk uploads

// POST /api/files/chunk - Upload a single encrypted chunk
export async function POST(request: Request) {
  // Apply rate limiting for chunk uploads
  const rateLimitResult = await rateLimit(request, RATE_LIMIT_CONFIGS.chunkUpload)
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
    const formData = await request.formData()
    const chunk = formData.get('chunk') as File
    const index = Number(formData.get('index'))
    const total = Number(formData.get('total'))
    const fileId = String(formData.get('fileId'))
    const iv_base_b64u = formData.get('iv_base_b64u') as string | null

    if (!chunk || isNaN(index) || isNaN(total) || !fileId) {
      return NextResponse.json(
        { error: 'Missing required fields: chunk, index, total, fileId' },
        { status: 400 }
      )
    }

    // Validate chunk size to prevent platform limit issues
    const maxChunkSize = 4 * 1024 * 1024 // 4MB limit
    if (chunk.size > maxChunkSize) {
      return NextResponse.json(
        { error: `Chunk size ${Math.round(chunk.size / 1024 / 1024)}MB exceeds 4MB limit` },
        { status: 413 }
      )
    }

    // Validate UUID format for fileId
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(fileId)) {
      return NextResponse.json(
        { error: 'Invalid file ID format' },
        { status: 400 }
      )
    }

    // Fetch file metadata to validate bounds and check expiry
    const { data: fileData, error: fileError } = await supabaseAdmin
      .from('files')
      .select('total_chunks, expires_at')
      .eq('id', fileId)
      .single()

    if (fileError || !fileData) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      )
    }

    // Check if file has expired
    if (new Date() > new Date(fileData.expires_at)) {
      return NextResponse.json(
        { error: 'File has expired' },
        { status: 410 }
      )
    }

    // Validate chunk index bounds (0-based indexing)
    if (index < 0 || index >= fileData.total_chunks) {
      return NextResponse.json(
        { error: `Chunk index ${index} out of bounds. Valid range: 0-${fileData.total_chunks - 1}` },
        { status: 400 }
      )
    }

    // Validate total chunks matches database
    if (total !== fileData.total_chunks) {
      return NextResponse.json(
        { error: `Total chunks mismatch. Expected: ${fileData.total_chunks}, received: ${total}` },
        { status: 400 }
      )
    }

    // Update database with base IV on first chunk
    if (iv_base_b64u && index === 0) {
      const { error: updateError } = await supabaseAdmin
        .from('files')
        .update({ iv_base_b64u })
        .eq('id', fileId)

      if (updateError) {
        console.error('Database update error:', updateError)
        return NextResponse.json(
          { error: 'Failed to update file metadata' },
          { status: 500 }
        )
      }
    }

    // Generate storage path for this chunk
    const path = `${fileId}/part-${String(index).padStart(5, '0')}`

    // Check if chunk already exists to prevent duplicates
    const { data: existingChunk, error: checkError } = await supabaseAdmin.storage
      .from('secrets')
      .list(fileId, {
        search: `part-${String(index).padStart(5, '0')}`
      })

    if (checkError) {
      console.error('Storage check error:', checkError)
      return NextResponse.json(
        { error: 'Failed to check existing chunks' },
        { status: 500 }
      )
    }

    // If chunk already exists, return success (idempotent operation)
    if (existingChunk && existingChunk.length > 0) {
      return NextResponse.json({ 
        ok: true, 
        message: 'Chunk already exists' 
      })
    }

    // Upload chunk to Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('secrets')
      .upload(path, chunk, {
        contentType: 'application/octet-stream',
        upsert: false
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload chunk' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET /api/files/chunk - Download a specific chunk
export async function GET(request: Request) {
  // Note: Rate limiting removed from chunk downloads as they are:
  // 1. Already protected by download tokens (can't download without valid token)
  // 2. Need to download many chunks quickly in parallel for good UX
  // 3. Each chunk is small and time-limited by token expiry
  
  try {
    const { searchParams } = new URL(request.url)
    const fileId = searchParams.get('fileId')
    const index = searchParams.get('index')
    const downloadToken = searchParams.get('downloadToken')

    if (!fileId || !index || !downloadToken) {
      return NextResponse.json(
        { error: 'Missing required parameters: fileId, index, downloadToken' },
        { status: 400 }
      )
    }

    // Validate UUID format for fileId
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(fileId)) {
      return NextResponse.json(
        { error: 'Invalid file ID format' },
        { status: 400 }
      )
    }

    // Validate download token and get file metadata
    const { data: isValidToken, error: tokenError } = await supabaseAdmin
      .rpc('validate_download_token', { 
        target_token: downloadToken, 
        target_file_id: fileId 
      })

    if (tokenError || !isValidToken) {
      return NextResponse.json(
        { error: 'Invalid or expired download token' },
        { status: 401 }
      )
    }

    // Fetch file metadata to validate chunk index bounds
    const { data: fileData, error: fileError } = await supabaseAdmin
      .from('files')
      .select('total_chunks')
      .eq('id', fileId)
      .single()

    if (fileError || !fileData) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      )
    }

    // Validate chunk index bounds (0-based indexing)
    const chunkIndex = Number(index)
    if (isNaN(chunkIndex) || chunkIndex < 0 || chunkIndex >= fileData.total_chunks) {
      return NextResponse.json(
        { error: `Chunk index ${index} out of bounds. Valid range: 0-${fileData.total_chunks - 1}` },
        { status: 400 }
      )
    }

    // Generate storage path for this chunk
    const path = `${fileId}/part-${String(index).padStart(5, '0')}`

    // Download chunk from Supabase Storage
    const { data: chunkData, error: downloadError } = await supabaseAdmin.storage
      .from('secrets')
      .download(path)

    if (downloadError || !chunkData) {
      console.error('Storage download error:', downloadError)
      return NextResponse.json(
        { error: 'Chunk not found' },
        { status: 404 }
      )
    }

    // Return the chunk as a blob
    const response = new NextResponse(chunkData, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': chunkData.size.toString()
      }
    })
    // Prevent caching of sensitive chunk data
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
