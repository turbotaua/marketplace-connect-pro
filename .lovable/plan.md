

# Підключення Shopify через Admin API (без вбудованої інтеграції)

## Проблема
Вбудована Shopify-інтеграція Lovable вимагає збігу email-адрес, що неможливо змінити. Альтернатива — пряме підключення через Shopify Admin API.

## Що потрібно від вас

### Крок 1: Створити Custom App у Shopify
1. Відкрийте Shopify Admin → Settings → Apps and sales channels → Develop apps
2. Натисніть "Create an app", дайте назву (наприклад, "TURBOTA Feed")
3. Натисніть "Configure Admin API scopes" і виберіть:
   - `read_products` — доступ до товарів
   - `read_inventory` — доступ до залишків
4. Натисніть "Install app"
5. Скопіюйте **Admin API access token** (він показується один раз!)

### Крок 2: Надати токен та URL магазину
Після створення апу я попрошу вас ввести:
- **SHOPIFY_ACCESS_TOKEN** — токен доступу
- **SHOPIFY_STORE_DOMAIN** — домен вашого магазину (наприклад, `your-store.myshopify.com`)

## Що буде зроблено технічно

### Збереження секретів
- Токен та домен зберігаються як захищені секрети в Lovable Cloud
- Доступні лише для Edge Functions, недоступні з браузера

### Edge Function для отримання товарів
- Створюється допоміжна функція, яка звертається до Shopify Admin REST API
- Використовує ендпоінт `GET /admin/api/2024-01/products.json`
- Отримує: товари, варіанти, ціни, залишки, фото, метаполя
- Пагінація для обробки 100-500 товарів

### Далі — продовження Фази 2
Після підключення Shopify API:
- Створення Edge Functions для генерації XML-фідів (Rozetka, MAUDAU, Epicentr)
- Валідація товарів
- Застосування цінових multiplier-ів
- Логування результатів

