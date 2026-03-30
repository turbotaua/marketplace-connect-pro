

# Покращення XML фіду Rozetka відповідно до вимог маркетплейсу

## Що зараз відсутнє (порівняно з вимогами Rozetka)

1. **Назва товару** -- зараз просто `product.title + variant.title`. Rozetka вимагає формулу: "Тип товару Бренд Модель Колір Характеристики (Артикул)". Не форматується.
2. **Гарантія** -- повністю відсутня. Rozetka показує гарантію з характеристики `<param name="Гарантія">`.
3. **Штрихкод** -- `variant.barcode` не використовується в Rozetka фіді (хоча Epicentr вже його виводить).
4. **Країна-виробник** -- відсутня.
5. **URL товару** -- тег `<url>` в offer не використовується (необов'язковий, але корисний).
6. **Стан товару** -- тег `<state>` не використовується.
7. **Metafields** -- Shopify API не запитує metafields для отримання додаткової інформації (гарантія, країна-виробник).

## Що зробимо

### 1. Розширити Shopify API запит для metafields

Shopify Products API з `fields=metafields` не повертає metafields (потрібен окремий запит або GraphQL). Замість цього використаємо **теги (tags)** Shopify як джерело додаткових даних. Shopify tags -- це найпростіший спосіб додати метадані без складного API.

**Конвенція тегів:**
- `warranty:12 місяців` -- гарантія
- `country:Китай` -- країна-виробник
- `state:new` -- стан товару (new/used/refurbished/stock)

Це просто, не потребує змін Shopify API, і адмін може легко редагувати теги в Shopify.

### 2. Додати нові теги в XML offer

В `generate-feed-rozetka/index.ts`:

- **`<param name="Гарантія">`** -- з тегу `warranty:...` або дефолт "12 місяців"
- **`<param name="Країна-виробник товару">`** -- з тегу `country:...`
- **`<param name="Штрих код">`** -- з `variant.barcode` (як в Epicentr)
- **`<url>`** -- посилання на Shopify handle: `https://{domain}/products/{handle}`
- **`<state>`** -- з тегу `state:...` або дефолт `new`

### 3. Покращити формат назви

Змінити логіку формування `<name>` та `<name_ua>`:
- Поточне: `"Product Title Variant Title"`
- Нове: `"Product Title Variant Title (SKU)"` -- додати артикул в дужках (як рекомендує Rozetka)
- Якщо SKU відсутній -- без дужок

### 4. Додати валідацію нових вимог

Нові validation errors:
- `no_description` -- якщо `body_html` порожній або коротший за 50 символів
- `no_barcode` -- якщо `variant.barcode` відсутній
- `title_too_long` -- якщо назва > 255 символів

### 5. Очистити description від заборонених елементів

Rozetka дозволяє лише певні HTML теги. Додати функцію `sanitizeDescription()` яка видаляє:
- `<img>`, `<video>`, `<iframe>`, `<script>`, `<style>`, `<a>` теги
- Атрибути `style`, `color` з дозволених тегів
- Залишає: `<p>`, `<b>`, `<strong>`, `<br>`, `<h1>`-`<h6>`, `<ul>`, `<ol>`, `<li>`, `<table>`, `<tbody>`, `<tr>`, `<td>`, `<th>`, `<div>`, `<span>`

## Файли для зміни

- `supabase/functions/generate-feed-rozetka/index.ts` -- основні зміни

## Технічні деталі

```text
Поточний XML offer:
  <offer id="..." available="true">
    <price>...</price>
    <currencyId>UAH</currencyId>
    <categoryId>...</categoryId>
    <picture>...</picture>
    <vendor>...</vendor>
    <article>...</article>
    <stock_quantity>...</stock_quantity>
    <name>Product Title</name>
    <name_ua>Product Title</name_ua>
    <description>...</description>
    <description_ua>...</description_ua>
    <param name="Option">Value</param>
  </offer>

Покращений XML offer:
  <offer id="..." available="true">
    <url>https://turbota.com.ua/products/handle</url>
    <price>...</price>
    <currencyId>UAH</currencyId>
    <categoryId>...</categoryId>
    <picture>...</picture>
    <vendor>...</vendor>
    <article>...</article>
    <stock_quantity>...</stock_quantity>
    <state>new</state>
    <name>Product Title (SKU)</name>
    <name_ua>Product Title (SKU)</name_ua>
    <description>...(sanitized HTML)...</description>
    <description_ua>...(sanitized HTML)...</description_ua>
    <param name="Option">Value</param>
    <param name="Гарантія">12 місяців</param>
    <param name="Країна-виробник товару">Китай</param>
    <param name="Штрих код">1234567890</param>
  </offer>
```

