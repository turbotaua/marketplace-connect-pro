

# Plan: Fix Category Matching Logic in Feed Functions

## Problem

The feed functions match products to categories using strict equality:
```
cm.shopify_collection_title === product.product_type
```

This fails because Shopify `product_type` values (e.g. "Свічки з дерев'яним гнотом", "Благодійні свічки") don't exactly match the mapping title (e.g. "Свічки"). Additionally, many products have empty `product_type` or types not covered by any mapping.

## Solution

### 1. Add `shopify_product_types` column to `category_mapping`

Add a text array column that stores all Shopify product_type values that should map to this category. This is more reliable than `includes()` which could cause false matches.

```sql
ALTER TABLE public.category_mapping 
  ADD COLUMN IF NOT EXISTS shopify_product_types TEXT[] DEFAULT '{}';
```

Then populate it with known product types from Shopify data:

| Mapping (shopify_collection_title) | shopify_product_types to add |
|---|---|
| Свічки (both Rozetka and MAUDAU) | {"Свічки", "Свічки з дерев'яним гнотом", "Благодійні свічки", "Свічки в кераміці"} |
| Дифузори (both) | {"Дифузори", "Аромадифузори"} |
| Постери (both) | {"Постери"} |
| Гастрономія (Tea) (both) | {"Чай", "Гастрономія"} |
| Аромасаше (both) | {"Аромасаше", "Ароматичні саше"} |

### 2. Update matching logic in all 3 feed functions

Replace:
```typescript
const catMapping = catMappings?.find((cm) => 
  cm.shopify_collection_title === product.product_type || 
  cm.shopify_collection_id === product.product_type
);
```

With:
```typescript
const catMapping = catMappings?.find((cm) => {
  // Match by product_types array (primary)
  if (cm.shopify_product_types?.length > 0 && product.product_type) {
    return cm.shopify_product_types.includes(product.product_type);
  }
  // Fallback: exact match on collection title
  return cm.shopify_collection_title === product.product_type;
});
```

### 3. Files to modify

- **Database migration**: Add `shopify_product_types` column
- **Data insert**: Populate the column for existing 10 mappings
- `supabase/functions/generate-feed-rozetka/index.ts` -- update matching logic (line 74)
- `supabase/functions/generate-feed-maudau/index.ts` -- update matching logic (line ~65)
- `supabase/functions/generate-feed-epicentr/index.ts` -- update matching logic (line ~65)
- `src/pages/Categories.tsx` -- add UI to manage product types array per mapping

### Expected result

Products with type "Свічки з дерев'яним гнотом" or "Благодійні свічки" will correctly map to the "Свічки" category, significantly increasing the number of offers in generated feeds (from ~72 to potentially 150+).

Products with empty `product_type` or truly unmapped types will still show as validation errors, which is correct behavior.
