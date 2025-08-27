-- Fix for the salt mismatch bug causing "Decryption failed unexpectedly"
-- The issue: validation uses validation_salt_b64u, but decryption needs pass_salt_b64u
-- Solution: Create a new function that returns BOTH salts for the metadata endpoint

-- Function to get complete metadata for notes (both validation and encryption salts)
CREATE OR REPLACE FUNCTION get_note_complete_meta(target_id UUID)
RETURNS TABLE (validation_salt_b64u TEXT, pass_salt_b64u TEXT, kdf_iters INT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT n.validation_salt_b64u, n.pass_salt_b64u, n.kdf_iters
  FROM notes n
  WHERE n.id = target_id 
    AND NOW() <= n.expires_at 
    AND n.views_left > 0
    AND n.passphrase_hash IS NOT NULL;
END; $$;

-- Function to get complete metadata for files (both validation and encryption salts)
CREATE OR REPLACE FUNCTION get_file_complete_meta(target_id UUID)
RETURNS TABLE (validation_salt_b64u TEXT, pass_salt_b64u TEXT, kdf_iters INT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT f.validation_salt_b64u, f.pass_salt_b64u, f.kdf_iters
  FROM files f
  WHERE f.id = target_id 
    AND NOW() <= f.expires_at
    AND f.passphrase_hash IS NOT NULL;
END; $$;