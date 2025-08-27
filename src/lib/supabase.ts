import { createClient } from '@supabase/supabase-js'

// Client-side Supabase client (uses anon key)
// The dummy fallback values prevent build-time errors when env vars are not set
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dummy.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy-anon-key'
)

// Server-side Supabase client (uses service role key)
// The dummy fallback values prevent build-time errors when env vars are not set
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dummy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'dummy-service-key'
)

// Database types
export interface Note {
  id: string
  ciphertext: string
  iv_b64u: string
  created_at: string
  expires_at: string
  views_left: number
  pass_salt_b64u: string | null
  kdf_iters: number | null
}

export interface FileRecord {
  id: string
  file_name: string
  size_bytes: number
  chunk_bytes: number
  total_chunks: number
  iv_base_b64u: string
  storage_path?: string
  created_at: string
  expires_at: string
  pass_salt_b64u: string | null
  kdf_iters: number | null
  encrypted_filename: string | null
  filename_iv: string | null
}
