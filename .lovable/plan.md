

# Виправлення: Додати параметри товарів у фід Rozetka

## Проблема

Розетка попереджає "Відсутні параметри" бо зараз `<param>` теги генеруються тільки для товарів з декількома варіантами. Для товарів з одним варіантом (Default Title) параметри не виводяться взагалі.

При цьому у Shopify є корисні дані в полі `options`, наприклад:
- Тип: Широкі (200мл)
- Матеріал свічки: Соєвий віск
- Час горіння: 20 годин

## Рішення

Завжди виводити параметри з `product.options`, незалежно від назви варіанта.

Для товарів з одним варіантом (Default Title) -- брати значення напряму з `options[i].values[0]`.
Для товарів з декількома варіантами -- як зараз, парсити значення з `variant.title`.

## Файл для зміни

**`supabase/functions/generate-feed-rozetka/index.ts`** -- блок параметрів (рядки ~129-140)

### Було:
```typescript
// Params from options
if (variant.title !== "Default Title" && product.options) {
  for (let i = 0; i < product.options.length; i++) {
    const optName = product.options[i]?.name;
    const optValues = variant.title?.split(" / ");
    if (optName && optValues?.[i]) {
      offerXml += `      <param name="${escapeXml(optName)}">${escapeXml(optValues[i])}</param>\n`;
    }
  }
}
```

### Стане:
```typescript
// Params from options (always output, not just for multi-variant products)
if (product.options) {
  for (let i = 0; i < product.options.length; i++) {
    const optName = product.options[i]?.name;
    let optValue: string | undefined;
    if (variant.title !== "Default Title") {
      const optValues = variant.title?.split(" / ");
      optValue = optValues?.[i];
    } else {
      optValue = product.options[i]?.values?.[0];
    }
    if (optName && optValue) {
      offerXml += `      <param name="${escapeXml(optName)}">${escapeXml(optValue)}</param>\n`;
    }
  }
}
```

## Що це дасть

- Кожен offer у фіді буде мати характеристики (Тип, Матеріал, Час горіння тощо)
- Попередження "Відсутні параметри" від Розетки зникне
- Зміна лише в одному файлі, ~10 рядків коду
