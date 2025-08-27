-- Migration: Restrict all database and storage operations to service_role only
-- This prevents anonymous users from bypassing API rate limits and validation

-- Drop existing policies that allow anonymous access
DROP POLICY IF EXISTS "notes_insert_policy" ON notes;
DROP POLICY IF EXISTS "files_insert_policy" ON files;
DROP POLICY IF EXISTS "secrets_insert_policy" ON storage.objects;

-- NOTES TABLE POLICIES - Service role only
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

-- FILES TABLE POLICIES - Service role only
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

-- STORAGE POLICIES for the 'secrets' bucket - Service role only
-- Allow INSERT (upload) only for service role
CREATE POLICY "secrets_insert_policy" ON storage.objects
FOR INSERT TO service_role WITH CHECK (bucket_id = 'secrets');

-- Allow SELECT (download) only for service role
CREATE POLICY "secrets_select_policy" ON storage.objects
FOR SELECT TO service_role USING (bucket_id = 'secrets');

-- Allow DELETE only for service role (cleanup process)
CREATE POLICY "secrets_delete_policy" ON storage.objects
FOR DELETE TO service_role USING (bucket_id = 'secrets');

-- RATE_LIMITS TABLE POLICIES remain service_role only (already correct)
-- Allow INSERT/SELECT/DELETE only for service role (used by rate limiting system)
CREATE POLICY "rate_limits_insert_policy" ON rate_limits
FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "rate_limits_select_policy" ON rate_limits
FOR SELECT TO service_role USING (true);

CREATE POLICY "rate_limits_delete_policy" ON rate_limits
FOR DELETE TO service_role USING (true);
