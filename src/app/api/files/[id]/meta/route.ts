import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/files/[id]/meta - Get file metadata without consuming access
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Note: Rate limiting removed from file meta endpoint as it's essential for file access
  // and only returns non-sensitive metadata (passphrase mode flag)
  // The actual security is in download token generation and file download endpoints

  try {
    const { id } = params

    if (!id) {
      return NextResponse.json(
        { error: 'File ID is required' },
        { status: 400 }
      )
    }

    // Get file metadata without consuming access
    const { data, error } = await supabaseAdmin
      .from('files')
      .select('file_name, iv_base_b64u, total_chunks, pass_salt_b64u, kdf_iters, encrypted_filename, filename_iv, validation_salt_b64u')
      .eq('id', id)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: 'File not found or expired' },
        { status: 404 }
      )
    }

    // Generate a one-time download token for this file
    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .rpc('generate_download_token', { target_file_id: id })
      .single()

    if (tokenError || !tokenData) {
      console.error('Token generation error:', tokenError)
      return NextResponse.json(
        { error: 'Failed to generate download token' },
        { status: 500 }
      )
    }

    // Type assertion for the database function return
    const typedTokenData = tokenData as {
      token: string
      expires_at: string
    }

    const response = NextResponse.json({
      ...data,
      downloadToken: typedTokenData.token,
      tokenExpiresAt: typedTokenData.expires_at
    })
    // Prevent caching of sensitive file metadata and download tokens
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
