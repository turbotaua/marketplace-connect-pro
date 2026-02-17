ALTER TABLE public.category_mapping 
  ADD COLUMN IF NOT EXISTS portal_id TEXT,
  ADD COLUMN IF NOT EXISTS rz_id TEXT,
  ADD COLUMN IF NOT EXISTS epicentr_category_code TEXT;