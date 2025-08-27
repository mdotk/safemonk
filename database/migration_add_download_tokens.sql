-- Migration: Add download tokens table for one-time file download authentication
-- This prevents unauthorized bandwidth consumption by requiring a token from the meta endpoint

-- DOWNLOAD_TOKENS table for file download authentication
CREATE TABLE download_tokens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id        UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  token          TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  used           BOOLEAN NOT NULL DEFAULT FALSE,
  is_multi_use   BOOLEAN NOT NULL DEFAULT FALSE  -- true for chunked files, false for whole files
);

-- Index for efficient token lookups
CREATE INDEX idx_download_tokens_token ON download_tokens (token);
CREATE INDEX idx_download_tokens_expires_at ON download_tokens (expires_at);
CREATE INDEX idx_download_tokens_file_id ON download_tokens (file_id);

-- Enable Row Level Security
ALTER TABLE download_tokens ENABLE ROW LEVEL SECURITY;

-- DOWNLOAD_TOKENS TABLE POLICIES
-- Allow INSERT/SELECT/UPDATE/DELETE only for service role
CREATE POLICY "download_tokens_insert_policy" ON download_tokens
FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "download_tokens_select_policy" ON download_tokens
FOR SELECT TO service_role USING (true);

CREATE POLICY "download_tokens_update_policy" ON download_tokens
FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "download_tokens_delete_policy" ON download_tokens
FOR DELETE TO service_role USING (true);

-- Function to generate and return a download token
CREATE OR REPLACE FUNCTION generate_download_token(target_file_id UUID)
RETURNS TABLE (token TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE
  new_token TEXT;
  token_expires_at TIMESTAMPTZ;
  file_chunks INT;
  is_multi_use_token BOOLEAN;
BEGIN
  -- Check if file exists and hasn't expired, get chunk count
  SELECT total_chunks INTO file_chunks
  FROM files 
  WHERE id = target_file_id 
    AND NOW() <= files.expires_at;
    
  IF file_chunks IS NULL THEN
    RAISE EXCEPTION 'File not found or expired';
  END IF;
  
  -- Generate a secure random token (32 bytes = 256 bits)
  new_token := encode(gen_random_bytes(32), 'base64');
  
  -- For chunked files (total_chunks > 1), create multi-use token with longer expiry
  -- For whole files, create single-use token with shorter expiry
  IF file_chunks > 1 THEN
    is_multi_use_token := TRUE;
    token_expires_at := NOW() + INTERVAL '10 minutes'; -- Longer for chunked downloads
  ELSE
    is_multi_use_token := FALSE;
    token_expires_at := NOW() + INTERVAL '5 minutes'; -- Shorter for single downloads
  END IF;
  
  -- Insert the token
  INSERT INTO download_tokens (file_id, token, expires_at, is_multi_use)
  VALUES (target_file_id, new_token, token_expires_at, is_multi_use_token);
  
  RETURN QUERY SELECT new_token, token_expires_at;
END; $$;

-- Function to validate and consume a download token (for single-file downloads only)
CREATE OR REPLACE FUNCTION consume_download_token(target_token TEXT)
RETURNS TABLE (file_id UUID, file_data JSONB) -- Return JSONB for flexibility
LANGUAGE plpgsql AS $$
DECLARE
  token_record download_tokens;
BEGIN
  -- Atomically find and lock the token
  SELECT * INTO token_record
  FROM download_tokens dt
  WHERE dt.token = target_token
    AND dt.used = FALSE
    AND NOW() <= dt.expires_at
  FOR UPDATE;

  -- If no valid token found, return nothing
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Explicitly reject multi-use tokens from this function
  -- Multi-use tokens are for chunked downloads and should use validate_download_token instead
  IF token_record.is_multi_use THEN
    RAISE EXCEPTION 'This token is for a chunked download and cannot be consumed here. Use the chunk download endpoint instead.';
  END IF;

  -- Mark the single-use token as used
  UPDATE download_tokens SET used = TRUE WHERE id = token_record.id;

  -- Return the file ID and the full file record as JSONB
  RETURN QUERY
  SELECT f.id, to_jsonb(f)
  FROM files f
  WHERE f.id = token_record.file_id
    AND NOW() <= f.expires_at;
END; $$;

-- Function to validate a download token without consuming it (for chunk downloads)
CREATE OR REPLACE FUNCTION validate_download_token(target_token TEXT, target_file_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM download_tokens dt
    JOIN files f ON f.id = dt.file_id
    WHERE dt.token = target_token
      AND dt.file_id = target_file_id
      AND dt.used = FALSE
      AND NOW() <= dt.expires_at
      AND NOW() <= f.expires_at
  );
END; $$;

-- Cleanup function for expired/used download tokens
CREATE OR REPLACE FUNCTION cleanup_download_tokens()
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM download_tokens 
  WHERE expires_at < NOW() OR used = TRUE;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END; $$;
