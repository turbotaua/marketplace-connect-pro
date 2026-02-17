

# Plan: Shopify Products Display, Category Mapping, and XML Feed Generation

This is a large feature set with 3 main parts. Here's what will be built:

## Part 1: Show Shopify Products on Dashboard

Add a collapsible product list section on the Dashboard page that fetches products from the `shopify-products` backend function.

- Display a table/grid with: product title, image thumbnail, vendor, product type, variant count, price range, availability status
- Show total product count
- Loading and error states

## Part 2: Enhanced Category Mapping

Update the Categories page to:
- Auto-load Shopify product types/collections from the Shopify API to make mapping easier (dropdown instead of manual input)
- Show which marketplace the mapping is for (Rozetka, MAUDAU, Epicentr)
- For MAUDAU: support `portal_id` field
- For Rozetka: support `rz_id` field 
- For Epicentr: support `category code` field

Database change needed:
- Add `portal_id` (for MAUDAU), `rz_id` (for Rozetka), and `epicentr_category_code` (for Epicentr) columns to `category_mapping` table

## Part 3: XML Feed Edge Functions

Create 3 new backend functions, one per marketplace:

### 3a. Rozetka Feed (`generate-feed-rozetka`)
Format: YML with CDATA for descriptions
```text
Key elements:
- yml_catalog with date attribute
- shop > name, company, url, currencies (UAH rate=1)
- categories with optional rz_id
- offers: each Shopify variant = separate offer
- Required: price, currencyId (UAH), categoryId, picture (https, max 15), vendor, name (with CDATA), description (with CDATA), stock_quantity, param
- Optional: name_ua, description_ua, price_old, article
```

### 3b. MAUDAU Feed (`generate-feed-maudau`)
Format: YML without CDATA, bilingual (ua/ru required)
```text
Key elements:
- yml_catalog > shop > categories (with portal_id) + offers
- Required: name_ua, name_ru, description_ua (no CDATA!), description_ru (no CDATA!), price, categoryId, picture (max 12)
- Optional: old_price, vendor, country, temperature_mode, param
- Each variant = separate offer
```

### 3c. Epicentr Feed (`generate-feed-epicentr`)
Format: YML with paramcode/valuecode for characteristics
```text
Key elements:
- yml_catalog > offers (no categories block, category inside offer)
- category with code attribute
- name lang="ua", name lang="ru"  
- description lang="ua/ru" with CDATA
- attribute_set code
- params with paramcode and valuecode
- availability element (in_stock / out_of_stock)
- price, price_old, picture
```

### Common logic in all feed functions:
1. Fetch all products from Shopify via Admin API
2. Apply validation (skip drafts, no-image products, price=0)
3. Load category mappings from DB
4. Load price multipliers from DB
5. Apply pricing: price x multiplier, then rounding
6. Generate XML string
7. Log result to `feed_logs` table
8. Log validation errors to `validation_errors` table
9. Return XML with `Content-Type: application/xml`
10. Store/update `feed_url` in `marketplace_config`

### Feed URL pattern:
Each feed will have a static URL via the backend function endpoint.

## Part 4: Dashboard "Generate Feed" Buttons

Add buttons on Dashboard marketplace cards to manually trigger feed generation with status feedback.

---

## Technical Details

### Database Migration
```sql
ALTER TABLE category_mapping 
  ADD COLUMN IF NOT EXISTS portal_id TEXT,
  ADD COLUMN IF NOT EXISTS rz_id TEXT,
  ADD COLUMN IF NOT EXISTS epicentr_category_code TEXT;
```

### New Files
- `supabase/functions/generate-feed-rozetka/index.ts`
- `supabase/functions/generate-feed-maudau/index.ts`
- `supabase/functions/generate-feed-epicentr/index.ts`

### Modified Files
- `src/pages/Dashboard.tsx` -- add products list + generate feed buttons
- `src/pages/Categories.tsx` -- add marketplace-specific fields (portal_id, rz_id, epicentr code)
- `supabase/config.toml` -- register 3 new functions with `verify_jwt = false`

### Key Implementation Notes
- Each Shopify variant becomes a separate offer (per business rules)
- Product IDs and category IDs must remain stable after first import
- XML special characters (", &, >, <, ') properly escaped
- UTF-8 encoding
- Rozetka: descriptions wrapped in CDATA
- MAUDAU: descriptions NOT wrapped in CDATA, HTML tags allowed directly
- Epicentr: descriptions in CDATA, characteristics use paramcode/valuecode system
- Max photos: Rozetka 15, MAUDAU 12, Epicentr unlimited
- Price = shopify_price x category_multiplier (if exists) or marketplace_multiplier, then rounding applied

