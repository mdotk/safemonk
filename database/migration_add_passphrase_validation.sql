-- Migration: Add passphrase validation to prevent incorrect passphrases from burning views
-- This fixes the security issue where wrong passphrases consume views before validation

-- Add passphrase_hash columns for server-side validation
ALTER TABLE notes ADD COLUMN passphrase_hash TEXT;
ALTER TABLE files ADD COLUMN passphrase_hash TEXT;

-- Add validation salt columns (separate from encryption salt for security)
ALTER TABLE notes ADD COLUMN validation_salt_b64u TEXT;
ALTER TABLE files ADD COLUMN validation_salt_b64u TEXT;

-- Function to validate passphrase for notes without burning a view
CREATE OR REPLACE FUNCTION validate_note_passphrase(target_id UUID, provided_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  stored_hash TEXT;
BEGIN
  SELECT passphrase_hash INTO stored_hash
  FROM notes
  WHERE id = target_id 
    AND NOW() <= expires_at 
    AND views_left > 0
    AND passphrase_hash IS NOT NULL;
  
  -- Return false if note not found, expired, no views left, or not passphrase-protected
  IF stored_hash IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Return true if hashes match
  RETURN stored_hash = provided_hash;
END; $$;

-- Function to validate passphrase for files without consuming download token
CREATE OR REPLACE FUNCTION validate_file_passphrase(target_id UUID, provided_hash TEXT)
RETURNS BOOLEAN  
LANGUAGE plpgsql AS $$
DECLARE
  stored_hash TEXT;
BEGIN
  SELECT passphrase_hash INTO stored_hash
  FROM files
  WHERE id = target_id 
    AND NOW() <= expires_at
    AND passphrase_hash IS NOT NULL;
  
  -- Return false if file not found, expired, or not passphrase-protected
  IF stored_hash IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Return true if hashes match
  RETURN stored_hash = provided_hash;
END; $$;

-- Function to get validation metadata for notes
CREATE OR REPLACE FUNCTION get_note_validation_meta(target_id UUID)
RETURNS TABLE (validation_salt_b64u TEXT, kdf_iters INT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT n.validation_salt_b64u, n.kdf_iters
  FROM notes n
  WHERE n.id = target_id 
    AND NOW() <= n.expires_at 
    AND n.views_left > 0
    AND n.passphrase_hash IS NOT NULL;
END; $$;

-- Function to get validation metadata for files
CREATE OR REPLACE FUNCTION get_file_validation_meta(target_id UUID)
RETURNS TABLE (validation_salt_b64u TEXT, kdf_iters INT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT f.validation_salt_b64u, f.kdf_iters
  FROM files f
  WHERE f.id = target_id 
    AND NOW() <= f.expires_at
    AND f.passphrase_hash IS NOT NULL;
END; $$;