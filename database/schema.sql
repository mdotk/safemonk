-- SafeMonk Database Schema
-- Run this in your Supabase SQL editor to set up the database

-- NOTES table for text secrets
CREATE TABLE notes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ciphertext     TEXT NOT NULL,
  iv_b64u        TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  views_left     INT NOT NULL DEFAULT 1,
  pass_salt_b64u TEXT,      -- null = link-with-key mode; present = passphrase mode
  kdf_iters      INT
);

-- Index for efficient cleanup of expired notes
CREATE INDEX idx_notes_expires_at ON notes (expires_at);

-- FILES table for encrypted file metadata
CREATE TABLE files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name         TEXT NOT NULL,
  size_bytes        BIGINT NOT NULL,
  chunk_bytes       INT NOT NULL,
  total_chunks      INT NOT NULL,
  iv_base_b64u      TEXT NOT NULL,   -- base IV; chunk counter appended for chunked files
  storage_path      TEXT NOT NULL,   -- path in storage bucket for cleanup
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  pass_salt_b64u    TEXT,
  kdf_iters         INT,
  encrypted_filename TEXT,           -- encrypted original filename (when hide filename is enabled)
  filename_iv       TEXT            -- IV used for filename encryption
);

-- Index for efficient cleanup of expired files
CREATE INDEX idx_files_expires_at ON files (expires_at);

-- RATE_LIMITS table for IP-based rate limiting
CREATE TABLE rate_limits (
  id         BIGSERIAL PRIMARY KEY,
  key        TEXT NOT NULL,
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip         INET
);

-- Index for efficient rate limit lookups and cleanup
CREATE INDEX idx_rate_limits_key_timestamp ON rate_limits (key, timestamp);
CREATE INDEX idx_rate_limits_timestamp ON rate_limits (timestamp);

-- Atomic burn-and-fetch function for notes
-- This ensures thread-safe decrementing of view counter
CREATE OR REPLACE FUNCTION burn_and_fetch_note(target_id UUID)
RETURNS TABLE (ciphertext TEXT, iv_b64u TEXT) 
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH tgt AS (
    SELECT * FROM notes
    WHERE id = target_id 
      AND NOW() <= expires_at 
      AND views_left > 0
    FOR UPDATE
  )
  UPDATE notes n
     SET views_left = tgt.views_left - 1
    FROM tgt
   WHERE n.id = tgt.id
  RETURNING n.ciphertext, n.iv_b64u;
END; $$;

-- Function to get note metadata without burning a view
CREATE OR REPLACE FUNCTION get_note_meta(target_id UUID)
RETURNS TABLE (pass_salt_b64u TEXT, kdf_iters INT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT n.pass_salt_b64u, n.kdf_iters
  FROM notes n
  WHERE n.id = target_id 
    AND NOW() <= n.expires_at 
    AND n.views_left > 0;
END; $$;

-- Cleanup function for expired notes
CREATE OR REPLACE FUNCTION cleanup_expired_notes()
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM notes WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END; $$;

-- Cleanup function for expired files
CREATE OR REPLACE FUNCTION cleanup_expired_files()
RETURNS TABLE (id UUID, file_name TEXT, storage_path TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  DELETE FROM files 
  WHERE expires_at < NOW()
  RETURNING files.id, files.file_name, files.storage_path;
END; $$;

-- Cleanup function for old rate limit entries (older than 1 hour)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM rate_limits WHERE timestamp < NOW() - INTERVAL '1 hour';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END; $$;

-- Enable Row Level Security for maximum security
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- NOTES TABLE POLICIES
-- Allow INSERT only for service role (API creates notes)
CREATE POLICY "notes_insert_policy" ON notes
FOR INSERT TO service_role WITH CHECK (true);

-- Allow SELECT only for service role (used by our API functions)
CREATE POLICY "notes_select_policy" ON notes
FOR SELECT TO service_role USING (true);

-- Allow UPDATE only for service role (used by burn_and_fetch_note function)
CREATE POLICY "notes_update_policy" ON notes
FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- Allow DELETE only for service role (used by cleanup functions)
CREATE POLICY "notes_delete_policy" ON notes
FOR DELETE TO service_role USING (expires_at < NOW());

-- FILES TABLE POLICIES
-- Allow INSERT only for service role (API creates file records)
CREATE POLICY "files_insert_policy" ON files
FOR INSERT TO service_role WITH CHECK (true);

-- Allow SELECT only for service role (used by our API functions)
CREATE POLICY "files_select_policy" ON files
FOR SELECT TO service_role USING (true);

-- Allow UPDATE only for service role (used for chunk upload coordination)
CREATE POLICY "files_update_policy" ON files
FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- Allow DELETE only for service role (used by cleanup functions)
CREATE POLICY "files_delete_policy" ON files
FOR DELETE TO service_role USING (expires_at < NOW());

-- STORAGE POLICIES for the 'secrets' bucket
-- Allow INSERT (upload) only for service role
CREATE POLICY "secrets_insert_policy" ON storage.objects
FOR INSERT TO service_role WITH CHECK (bucket_id = 'secrets');

-- Allow SELECT (download) only for service role
CREATE POLICY "secrets_select_policy" ON storage.objects
FOR SELECT TO service_role USING (bucket_id = 'secrets');

-- Allow DELETE only for service role (cleanup process)
CREATE POLICY "secrets_delete_policy" ON storage.objects
FOR DELETE TO service_role USING (bucket_id = 'secrets');

-- RATE_LIMITS TABLE POLICIES
-- Allow INSERT/SELECT/DELETE only for service role (used by rate limiting system)
CREATE POLICY "rate_limits_insert_policy" ON rate_limits
FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "rate_limits_select_policy" ON rate_limits
FOR SELECT TO service_role USING (true);

CREATE POLICY "rate_limits_delete_policy" ON rate_limits
FOR DELETE TO service_role USING (true);

-- Security function to validate API requests
CREATE OR REPLACE FUNCTION is_service_role()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN auth.role() = 'service_role';
END; $$;

-- Create storage bucket for encrypted files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('secrets', 'secrets', false)
ON CONFLICT (id) DO NOTHING;
