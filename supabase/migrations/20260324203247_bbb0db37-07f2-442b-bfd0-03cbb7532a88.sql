-- Add a restrictive policy - only service role can access this table
-- This silences the linter warning while keeping the table secure
CREATE POLICY "Service role only" ON public.drive_configs
  FOR ALL USING (false);