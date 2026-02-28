
-- Dilovod AI Portal: Phase 1 Database Schema

-- 1. Chat sessions
CREATE TABLE public.dilovod_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dilovod_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on dilovod_sessions"
  ON public.dilovod_sessions FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- 2. Chat messages
CREATE TABLE public.dilovod_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.dilovod_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL DEFAULT '',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dilovod_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on dilovod_messages"
  ON public.dilovod_messages FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE INDEX idx_dilovod_messages_session ON public.dilovod_messages(session_id);

-- 3. Drafts
CREATE TABLE public.dilovod_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.dilovod_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('sales.commission', 'sales.end_consumer', 'sales.return', 'purchase.goods', 'purchase.services')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'needs_attention', 'approved', 'rejected', 'written', 'error')),
  source_file_url TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  flags TEXT[] DEFAULT '{}',
  dilovod_ids JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dilovod_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on dilovod_drafts"
  ON public.dilovod_drafts FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE INDEX idx_dilovod_drafts_session ON public.dilovod_drafts(session_id);
CREATE INDEX idx_dilovod_drafts_status ON public.dilovod_drafts(status);

CREATE TRIGGER update_dilovod_drafts_updated_at
  BEFORE UPDATE ON public.dilovod_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Audit log (append-only: SELECT + INSERT only)
CREATE TABLE public.dilovod_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES public.dilovod_drafts(id),
  user_id UUID NOT NULL,
  action_type TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('extracted', 'approved', 'written', 'rejected', 'error')),
  source_file_url TEXT,
  payload_snapshot JSONB NOT NULL DEFAULT '{}',
  dilovod_ids JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dilovod_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read on dilovod_audit_log"
  ON public.dilovod_audit_log FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admin insert on dilovod_audit_log"
  ON public.dilovod_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE INDEX idx_dilovod_audit_operator ON public.dilovod_audit_log(user_id);
CREATE INDEX idx_dilovod_audit_created ON public.dilovod_audit_log(created_at);

-- 5. Catalog cache
CREATE TABLE public.dilovod_catalog_cache (
  cache_key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL DEFAULT '{}',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ttl_hours INT NOT NULL DEFAULT 24
);

ALTER TABLE public.dilovod_catalog_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on dilovod_catalog_cache"
  ON public.dilovod_catalog_cache FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
