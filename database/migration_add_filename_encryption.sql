-- Migration to add filename encryption support
-- Run this in your Supabase SQL editor if you have an existing SafeMonk database

-- Add new columns for encrypted filename support
ALTER TABLE files 
ADD COLUMN IF NOT EXISTS encrypted_filename TEXT,
ADD COLUMN IF NOT EXISTS filename_iv TEXT;

-- Add comments to document the new columns
COMMENT ON COLUMN files.encrypted_filename IS 'Encrypted original filename (when hide filename is enabled)';
COMMENT ON COLUMN files.filename_iv IS 'IV used for filename encryption';
