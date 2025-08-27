import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rateLimit, RATE_LIMIT_CONFIGS } from '@/lib/rateLimit'
import { contentDispositionAttachment } from '@/lib/crypto'

// POST /api/files/[id]/download - Download encrypted file (consumes access)
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Apply rate limiting for file downloads
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

    // Get the download token from request body
    const body = await request.json()
    const { downloadToken } = body

    if (!downloadToken) {
      return NextResponse.json(
        { error: 'Download token is required' },
        { status: 400 }
      )
    }

    // Validate and consume the download token
    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .rpc('consume_download_token', { target_token: downloadToken })
      .single()

    if (tokenError || !tokenData) {
      console.error('Token validation error:', tokenError)
      return NextResponse.json(
        { error: 'Invalid or expired download token' },
        { status: 401 }
      )
    }

    // Type assertion for the database function return
    // The function now returns file_data as JSONB
    const typedTokenData = tokenData as {
      file_id: string
      file_data: any // JSONB is returned as a parsed object
    }

    // Verify the token is for the correct file
    if (typedTokenData.file_id !== id) {
      return NextResponse.json(
        { error: 'Token file ID mismatch' },
        { status: 401 }
      )
    }

    // Parse the file_data JSONB
    const fileData = typedTokenData.file_data as {
      id: string
      file_name: string
      size_bytes: number
      chunk_bytes: number
      total_chunks: number
      iv_base_b64u: string
      storage_path: string
      created_at: string
      expires_at: string
      pass_salt_b64u: string | null
      kdf_iters: number | null
      encrypted_filename: string | null
      filename_iv: string | null
    }

    // For whole files (total_chunks = 1), download from storage
    if (fileData.total_chunks === 1) {
      const storagePath = fileData.storage_path || `${id}.bin` // fallback for backwards compatibility
      
      const { data: storageData, error: storageError } = await supabaseAdmin.storage
        .from('secrets')
        .download(storagePath)

      if (storageError || !storageData) {
        console.error('Storage download error:', storageError)
        return NextResponse.json(
          { error: 'File not found in storage' },
          { status: 404 }
        )
      }

      // Delete from storage first to avoid orphaned objects (burn after read)
      const { error: storageDeleteError } = await supabaseAdmin.storage
        .from('secrets')
        .remove([storagePath])

      if (storageDeleteError) {
        console.error('Storage delete error:', storageDeleteError)
        // Continue with DB deletion even if storage fails to avoid orphaned DB records
        // The cleanup script will handle orphaned storage objects
      }

      // Delete the file record after storage deletion attempt
      const { error: dbDeleteError } = await supabaseAdmin
        .from('files')
        .delete()
        .eq('id', id)

      if (dbDeleteError) {
        console.error('Database delete error:', dbDeleteError)
        // Log but don't fail the response since file was already downloaded
      }

      // Return the encrypted file blob
      const response = new NextResponse(storageData, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': contentDispositionAttachment(`${fileData.file_name}.encrypted`)
        }
      })
      // Prevent caching of sensitive file data
      response.headers.set('Cache-Control', 'no-store')
      return response
    } else {
      // For chunked files, this endpoint shouldn't be used
      // Chunked files should be downloaded via the chunk endpoint
      return NextResponse.json(
        { error: 'Use chunk endpoint for chunked files' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
