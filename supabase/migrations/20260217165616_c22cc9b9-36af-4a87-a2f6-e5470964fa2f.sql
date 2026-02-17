
-- Helper function: check if user is authenticated (simple admin check)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL;
$$;

-- Marketplace config table
CREATE TABLE public.marketplace_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  feed_url TEXT,
  global_multiplier NUMERIC(5,4) NOT NULL DEFAULT 1.0000,
  rounding_rule TEXT NOT NULL DEFAULT 'math' CHECK (rounding_rule IN ('math', 'dot99', 'round5', 'round10')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.marketplace_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on marketplace_config"
  ON public.marketplace_config FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- Insert default marketplaces
INSERT INTO public.marketplace_config (name, slug, global_multiplier) VALUES
  ('Rozetka', 'rozetka', 1.15),
  ('MAUDAU', 'maudau', 1.18),
  ('Epicentr', 'epicentr', 1.12);

-- Category mapping table
CREATE TABLE public.category_mapping (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_collection_id TEXT NOT NULL,
  shopify_collection_title TEXT,
  marketplace_id UUID NOT NULL REFERENCES public.marketplace_config(id) ON DELETE CASCADE,
  marketplace_category_id TEXT NOT NULL,
  marketplace_category_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shopify_collection_id, marketplace_id)
);

ALTER TABLE public.category_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on category_mapping"
  ON public.category_mapping FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- Price multipliers table (category-level overrides)
CREATE TABLE public.price_multipliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  marketplace_id UUID NOT NULL REFERENCES public.marketplace_config(id) ON DELETE CASCADE,
  shopify_collection_id TEXT NOT NULL,
  shopify_collection_title TEXT,
  multiplier NUMERIC(5,4) NOT NULL DEFAULT 1.0000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(marketplace_id, shopify_collection_id)
);

ALTER TABLE public.price_multipliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on price_multipliers"
  ON public.price_multipliers FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- Feed logs table
CREATE TABLE public.feed_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  marketplace_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'error')),
  product_count INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feed_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read access on feed_logs"
  ON public.feed_logs FOR SELECT
  USING (is_admin());

-- Allow edge functions to insert logs (service role)
CREATE POLICY "Service insert on feed_logs"
  ON public.feed_logs FOR INSERT
  WITH CHECK (true);

-- Validation errors table
CREATE TABLE public.validation_errors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  feed_log_id UUID REFERENCES public.feed_logs(id) ON DELETE CASCADE,
  marketplace_slug TEXT NOT NULL,
  product_sku TEXT,
  product_title TEXT,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.validation_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read access on validation_errors"
  ON public.validation_errors FOR SELECT
  USING (is_admin());

CREATE POLICY "Service insert on validation_errors"
  ON public.validation_errors FOR INSERT
  WITH CHECK (true);

-- Update timestamps trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_marketplace_config_updated_at
  BEFORE UPDATE ON public.marketplace_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_category_mapping_updated_at
  BEFORE UPDATE ON public.category_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_price_multipliers_updated_at
  BEFORE UPDATE ON public.price_multipliers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
