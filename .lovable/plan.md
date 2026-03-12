

# Вибір категорій для включення у фід

## Що зробимо

Додамо можливість вмикати/вимикати кожну категорію в маппінгу. Вимкнені категорії не потраплятимуть у XML-фід. Це дозволить виключити "стоп-категорії" (наприклад, "чай") без видалення маппінгу.

## Зміни

### 1. База даних -- нова колонка `is_active`

Додамо колонку `is_active` (boolean, default `true`) до таблиці `category_mapping`. Всі існуючі записи автоматично отримають значення `true`, тож нічого не зламається.

### 2. UI -- тогл в таблиці категорій

На сторінці "Mapping категорій" додамо Switch (тогл) у кожному рядку таблиці. Увімкнено = категорія потрапляє у фід, вимкнено = пропускається. Вимкнені рядки будуть візуально приглушені.

### 3. Фіди -- фільтрація вимкнених категорій

У всіх трьох edge-функціях (Rozetka, MAUDAU, Epicentr) додамо перевірку: якщо `catMapping.is_active === false`, товар пропускається (без запису помилки валідації, бо це свідомий вибір).

## Технічні деталі

**Міграція SQL:**
```sql
ALTER TABLE category_mapping ADD COLUMN is_active boolean NOT NULL DEFAULT true;
```

**Файли для зміни:**
- `src/pages/Categories.tsx` -- додати колонку Switch
- `supabase/functions/generate-feed-rozetka/index.ts` -- фільтр `is_active`
- `supabase/functions/generate-feed-maudau/index.ts` -- фільтр `is_active`
- `supabase/functions/generate-feed-epicentr/index.ts` -- фільтр `is_active`

**Логіка у фідах (однакова для всіх трьох):**
Після знаходження `catMapping`, додати перевірку:
```typescript
if (catMapping.is_active === false) continue;
```

