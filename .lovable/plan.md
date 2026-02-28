

## Problem Analysis

From the edge function logs, the agentic loop **is working** — it successfully found "Зелень, Львів" for query "зелень" and items for "київські каштани". Two distinct issues remain:

1. **"Не вказано" problem**: When the user doesn't mention a counterparty, the AI sends literal `"Не вказано"` as the search query instead of reasoning about how to find the counterparty from other data.
2. **"банка 130мл" problem**: `search_item({"query":"банка 130мл для міні свічок"})` returns `{"result":[]}` — the item exists in Dilovod but the search query doesn't match. The AI retried with `"банка 130мл"` — still empty. This is a search term mismatch, not a timeout.

## Changes

### 1. `supabase/functions/dilovod-proxy/index.ts` — Add `getItemSuppliers` action

New case in the switch that queries purchase/receipt documents (`documents.buy` or the movement register) filtered by item ID, returning distinct counterparties. Uses the existing `callDilovod` + `request` action against Dilovod's purchase documents to find which suppliers have historically supplied a given item.

```typescript
case "getItemSuppliers": {
  // Query purchase receipts (documents.buy) filtered by item to find historical suppliers
  const itemId = params.itemId;
  result = await callDilovod(apiKey, "request", {
    from: "documents.buy",
    fields: {
      id: "doc_id",
      person: "person",
      "person.name": "person_name",
      "person.code": "person_code",
      date: "doc_date",
    },
    filters: [
      { alias: "tpGoods.good", operator: "=", value: itemId },
    ],
    limit: params.limit || 20,
  });
  break;
}
```

### 2. `supabase/functions/dilovod-chat/index.ts` — Add tool + update system prompt

**Add tool definition:**
```typescript
{
  type: "function",
  function: {
    name: "get_item_suppliers",
    description: "Знаходить контрагентів (постачальників), з якими цей товар фігурував у попередніх надходженнях. Використовуй коли контрагент не вказаний користувачем — щоб визначити найімовірнішого постачальника.",
    parameters: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "ID товару в Діловод (отриманий з search_item)" },
      },
      required: ["itemId"],
    },
  },
}
```

**Add to TOOL_TO_ACTION map:**
```typescript
get_item_suppliers: "getItemSuppliers",
```

**Update system prompt** — add rule for missing counterparty:

```
9. Якщо контрагент НЕ вказаний в повідомленні користувача — НЕ пиши "Не вказано".
   Замість цього:
   a) Спочатку знайди товари через search_item
   b) Для першого знайденого товару виклич get_item_suppliers(itemId)
   c) Якщо є один постачальник — використай його і повідом користувача що визначив автоматично
   d) Якщо є кілька — постав dilovod_id: null і заповни candidates[] постачальниками
   e) Якщо нема — тоді запитай користувача
10. НІКОЛИ не передавай "Не вказано", "невідомо", "не зазначено" в search_counterparty. Це не назва.
```

### 3. Deploy `dilovod-proxy` and `dilovod-chat`

Both functions need redeployment after changes.

### Summary of changes

| File | Change |
|---|---|
| `supabase/functions/dilovod-proxy/index.ts` | Add `getItemSuppliers` case — query purchase docs by item ID to return historical suppliers |
| `supabase/functions/dilovod-chat/index.ts` | Add `get_item_suppliers` tool definition + mapping. Update system prompt: rule 9 (infer counterparty from item history) + rule 10 (never search "Не вказано") |

