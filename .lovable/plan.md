

# Оновлення формату назви та характеристик для Rozetka XML

## Аналіз поточного стану vs Rozetka

З продукту на Rozetka видно характеристики, яких немає в XML:
- Вид (Ароматичні, Декоративні)
- Тип (Свічки)
- Аромат (Свіжий, Хвойний, Цитрусовий)
- Матеріал свічки (Соєвий віск)
- Час горіння (30 год)
- Висота (9 см)
- Колір (Білий)
- Свічник (Скляний)
- Країна реєстрації бренду (Україна)
- Гарантія (14 днів, не 12 місяців як зараз за замовчуванням)

## Що зробимо

### 1. Новий формат назви

Shopify product.title = "Київські каштани" (тільки назва аромату), variant.title = "250 мл".

Конструюємо Rozetka-назву: `{product_type} {vendor} {product.title} {variant.title}`

Результат: **"Ароматична свічка Turbota candles Київські каштани 250 мл"**

- Прибираємо суфікс `(SKU)` з назви
- Якщо variant.title = "Default Title" -- не додаємо його
- product_type і vendor вже є в Shopify API

### 2. Розширити конвенцію тегів для характеристик

Нові Shopify теги для `<param>`:

```text
вид:Ароматичні,Декоративні    → <param name="Вид">Ароматичні, Декоративні</param>
тип:Свічки                    → <param name="Тип">Свічки</param>
аромат:Свіжий,Хвойний         → <param name="Аромат">Свіжий, Хвойний</param>
матеріал:Соєвий віск          → <param name="Матеріал свічки">Соєвий віск</param>
час_горіння:30 год             → <param name="Час горіння">30 год</param>
висота:9 см                   → <param name="Висота">9 см</param>
колір:Білий                   → <param name="Колір">Білий</param>
свічник:Скляний               → <param name="Свічник">Скляний</param>
```

`warranty:` і `country:` залишаються як є, але дефолт гарантії змінюємо з "12 місяців" на "14 днів".

### 3. Зміни в edge function

В `supabase/functions/generate-feed-rozetka/index.ts`:

- **Назва**: `{product_type} {vendor} {product.title} {variant.title}` замість `{product.title}{variantTitle}{skuSuffix}`
- **Характеристики**: парсимо всі нові теги і додаємо як `<param>`
- **Гарантія**: дефолт "14 днів"
- Product options (`product.options`) залишаються як є

### Файли для зміни

- `supabase/functions/generate-feed-rozetka/index.ts`

