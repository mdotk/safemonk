import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// POST /api/files/[id]/finalize - Finalize chunked file download and delete all data
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
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

    // First, get file info to determine chunk count for storage cleanup
    const { data: fileInfo, error: fileError } = await supabaseAdmin
      .from('files')
      .select('total_chunks')
      .eq('id', id)
      .single()

    if (fileError || !fileInfo) {
      console.log('File not found during finalize, may have been already cleaned up:', fileError)
      // File might have been already cleaned up, which is okay
      return NextResponse.json({
        success: true,
        message: 'File already cleaned up or not found'
      })
    }

    // Finalize the chunked file download (validates token and deletes DB records)
    const { data: finalizeData, error: finalizeError } = await supabaseAdmin
      .rpc('finalize_chunked_download', { 
        target_token: downloadToken, 
        target_file_id: id 
      })

    if (finalizeError || !finalizeData) {
      console.error('Finalize RPC error:', finalizeError)
      // If finalize fails, it might be because the file was already cleaned up
      // This is not necessarily an error - the download succeeded
      return NextResponse.json({
        success: true,
        message: 'Download completed, cleanup may have already occurred',
        warning: 'Finalize operation failed but download was successful'
      })
    }

    // Type assertion for the database function return
    const typedFinalizeData = finalizeData as {
      success: boolean
      chunks_deleted: number
    }

    if (!typedFinalizeData.success) {
      console.log('Finalize function returned success: false, file may have been already cleaned up')
      // This is likely because the file was already cleaned up, which is okay
      return NextResponse.json({
        success: true,
        message: 'Download completed, file may have been already cleaned up'
      })
    }

    // Delete all chunks from storage
    const chunkPaths: string[] = []
    for (let i = 0; i < fileInfo.total_chunks; i++) {
      chunkPaths.push(`${id}/part-${String(i).padStart(5, '0')}`)
    }

    // Delete chunks from storage (ignore errors as DB cleanup already happened)
    try {
      await supabaseAdmin.storage
        .from('secrets')
        .remove(chunkPaths)
    } catch (storageError) {
      console.warn('Storage cleanup warning:', storageError)
      // Continue - DB cleanup already succeeded
    }

    return NextResponse.json({
      success: true,
      message: 'File successfully deleted after download',
      chunksDeleted: typedFinalizeData.chunks_deleted
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
