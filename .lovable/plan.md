# Промо-акції для маркетплейсів

## Ідея

Так, це цілком можливо. Зараз акційна ціна (`price_old` / `old_price`) формується тільки з Shopify `compare_at_price`. Ми додамо окрему систему промо-акцій, яка дозволить задавати знижки на конкретні товари для конкретного маркетплейсу, незалежно від Shopify.

## Як це працюватиме

1. Ви створюєте промо-акцію: обираєте маркетплейс, задаєте % знижки та дати (початок/кінець)
2. Додаєте товари до акції (по Назві, SKU або по категорії)
3. При генерації фіду: якщо товар потрапляє в активну акцію, його поточна ціна стає `price_old`, а нова ціна = поточна ціна мінус знижка

## Зміни

### 1. База даних -- дві нові таблиці

`**promotions**` -- акції:

- `id`, `marketplace_id`, `name` (назва акції), `discount_percent`, `starts_at`, `ends_at`, `is_active`, timestamps

`**promotion_items**` -- товари в акції:

- `id`, `promotion_id`, `shopify_product_id` (text), `shopify_variant_id` (text, nullable -- якщо null, то всі варіанти)

### 2. UI -- нова сторінка "Промо"

Нова сторінка в адмінці з можливістю:

- Створити акцію (назва, маркетплейс, %, дати)
- Додати товари (вибір з Shopify через пошук)
- Увімкнути/вимкнути акцію
- Бачити список активних акцій

### 3. Фіди -- застосування знижки

У кожному фіді після розрахунку `finalPrice`:

- Перевірити чи товар/варіант потрапляє в активну промо-акцію для цього маркетплейсу
- Якщо так: `price_old = finalPrice`, `price = finalPrice * (1 - discount/100)`, округлити

Це не зламає існуючу логіку -- якщо акцій немає, все працює як раніше. Акційна ціна з промо має пріоритет над Shopify `compare_at_price`.

### 4. Навігація

Додати пункт "Промо" в бічне меню адмінки.

## Технічні деталі

**SQL міграція:**

```sql
CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_id uuid NOT NULL,
  name text NOT NULL,
  discount_percent numeric NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE promotion_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  shopify_product_id text NOT NULL,
  shopify_variant_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Логіка у фідах (псевдокод):**

```typescript
// Load active promotions for this marketplace
const { data: promos } = await sb.from("promotions")
  .select("*, promotion_items(*)")
  .eq("marketplace_id", mpConfig.id)
  .eq("is_active", true)
  .lte("starts_at", now)
  .gte("ends_at", now);

// In variant loop:
const promoItem = findMatchingPromo(promos, product.id, variant.id);
if (promoItem) {
  priceOld = finalPrice;
  finalPrice = applyRounding(finalPrice * (1 - promo.discount_percent / 100), ...);
}
```

**Файли:**

- Нова сторінка `src/pages/Promotions.tsx`
- Оновити `src/App.tsx` (роут) та `src/components/AdminLayout.tsx` (меню)
- Оновити всі 3 edge functions