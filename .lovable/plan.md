

## Problem

1. **Commission flow is mixed up.** Current "Продаж магазинам (комісія)" implies one action creates everything (Order → Invoice → Transfer → Report). In reality, **Transfer to Consignee** and **Commission Report** are separate business events separated by weeks/months. Transfer happens when goods are sent to the store. Report happens when the store actually sells them and reports back.

2. **Action labels are unclear.** "Комісія", "Споживач", "Товари" don't tell the user what documents will be created.

3. **Page title doesn't say "Dilovod AI"** — greeting says "Turbota" with no context about what the tool does.

4. **Tools pages need merging** — Dashboard, Prices, Categories, Logs should be one "XML та Маркетплейси" page.

## Changes

### 1. Split commission into separate actions & redesign all ActionTags

New `ActionType` list reflecting actual separate business operations:

```text
ПРОДАЖІ:
  "sales.order"        → "Замовлення покупцю"        (Створює: Замовлення + Рахунок)
  "sales.commission"   → "Передача комісіонеру"      (На підставі замовлення → Передача)
  "sales.report"       → "Звіт комісіонера"          (На підставі передачі → Звіт про продажі)
  "sales.shipment"     → "Відвантаження споживачу"   (На підставі замовлення → Відвантаження)
  "sales.return"       → "Повернення від покупця"     (На підставі відвантаження)

ЗАКУПІВЛІ:
  "purchase.order"     → "Замовлення постачальнику"   (Створює замовлення)
  "purchase.receipt"   → "Надходження товарів/послуг" (На підставі замовлення або без)

ВИРОБНИЦТВО:
  "production.order"   → "Замовлення на виробництво"  (Перевірка специфікації → Створення)
```

Each action tag becomes a card with:
- **Title**: what you're doing (e.g. "Передача комісіонеру")
- **Subtitle**: what documents get created (e.g. "На підставі існуючого замовлення")

### 2. Rename page title

- Greeting: `"{getGreeting()}, Turbota"` → subtitle below: **"Dilovod AI — автоматизація документообігу"**

### 3. Merge tools into single page

- Create `src/pages/Marketplaces.tsx` with tabs: Огляд, Ціни, Категорії, Логи
- Import content from existing Dashboard, Prices, Categories, Logs pages
- Sidebar: replace 4 links with single "XML та Маркетплейси" link
- Update routes in App.tsx

### Files to change

| File | What |
|---|---|
| `src/pages/Dilovod.tsx` | New ActionType union, updated labels, page subtitle |
| `src/components/dilovod/ActionTags.tsx` | Redesign to grouped cards with descriptions |
| `src/components/dilovod/DraftCard.tsx` | Update chainLabels and actionLabels for new types |
| `src/pages/Marketplaces.tsx` | **New** — tabbed page combining Dashboard/Prices/Categories/Logs |
| `src/components/AdminLayout.tsx` | Sidebar: single "XML та Маркетплейси" link |
| `src/App.tsx` | Add `/marketplaces` route, keep old routes as redirects |

