
-- Drop permissive INSERT policies
DROP POLICY "Service insert on feed_logs" ON public.feed_logs;
DROP POLICY "Service insert on validation_errors" ON public.validation_errors;

-- Edge functions use service_role key which bypasses RLS, so no INSERT policy needed for anon
-- Admin can also insert via authenticated access
CREATE POLICY "Admin insert on feed_logs"
  ON public.feed_logs FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admin insert on validation_errors"
  ON public.validation_errors FOR INSERT
  WITH CHECK (is_admin());
