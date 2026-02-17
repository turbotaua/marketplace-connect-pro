ALTER TABLE public.category_mapping 
  ADD COLUMN IF NOT EXISTS shopify_product_types TEXT[] DEFAULT '{}';