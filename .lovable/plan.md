

## Plan: Connect AI to Chat + Update Commission & Purchase Chains

### 1. Create `dilovod-chat` Edge Function

New file: `supabase/functions/dilovod-chat/index.ts`

Uses Lovable AI (Gemini Flash) as the AI backend. The function:
- Receives `{ messages, sessionId, actionType }` from the frontend
- Sends conversation history to AI with a system prompt that understands Dilovod business logic
- System prompt instructs AI to:
  - Help user understand what action to choose
  - Parse uploaded file names / user descriptions into draft documents
  - Return structured JSON drafts (via tool calling) when it has enough info
  - Ask clarifying questions when ambiguous
- Streams response back via SSE for real-time token rendering
- Handles 429/402 errors gracefully

System prompt will include knowledge of all 8 action types with their document chains explained in plain Ukrainian.

### 2. Update `Dilovod.tsx` — Replace Simulated Responses with AI Streaming

- Remove the `setTimeout` mock response in `handleSend`
- Add `streamChat()` utility that calls the edge function and renders tokens as they arrive
- Update the assistant message progressively (token-by-token) using `setMessages` pattern from the Lovable AI docs
- Show a typing indicator while streaming
- Handle errors (429, 402, network) with toast notifications

### 3. Update Commission Chain: `sales.commission`

**ActionTags label**: "Комісія (повний ланцюжок)"
**Description**: "Замовлення → Рахунок → Передача → Видаткова накладна"

**Backend (`dilovod-proxy`)**: Update the `sales.commission` chain to 4 steps:
1. Sales Order (`saleOrderCreate`)
2. Invoice (`documents.saleInvoice`, baseDoc=order)
3. Transfer to Consignee (`documents.sale`, docMode=commission, baseDoc=order)
4. Expense Invoice / Видаткова накладна (`documents.sale`, docMode=goods, baseDoc=order)

Remove Step 4 (commission report) from this chain — `sales.report` stays separate.

**DraftCard `chainLabels`**: `["Замовлення", "Рахунок", "Передача комісіонеру", "Видаткова накладна"]`
**ConfirmationMessage**: Add `expense_invoice_id: "Видаткова накладна"`

### 4. Update Purchase Chain: `purchase.receipt`

**ActionTags label**: "Надходження товарів/послуг"
**Description**: "Замовлення + Надходження (або тільки надходження)"

**Backend (`dilovod-proxy`)**: The existing logic already supports `draft.createSupplierOrder` flag. The AI system prompt will instruct the model to ask the user: "Чи є замовлення постачальнику, чи створити одразу надходження?"

**DraftCard `chainLabels`**: `["Замовлення (опціонально)", "Надходження"]`

Merge `purchase.order` into `purchase.receipt` as a single action with optional order step. Remove `purchase.order` as a separate ActionType.

### 5. Simplify ActionTypes

Remove `purchase.order` as standalone — it becomes part of `purchase.receipt`. Updated list:

```text
sales.order, sales.commission, sales.report, sales.shipment, sales.return,
purchase.receipt, production.order
```

7 actions instead of 8. Cleaner for the user.

### Files to Change

| File | What |
|---|---|
| `supabase/functions/dilovod-chat/index.ts` | **New** — AI chat edge function with streaming |
| `supabase/config.toml` | Add `dilovod-chat` function config |
| `src/pages/Dilovod.tsx` | Replace mock responses with AI streaming, remove `purchase.order` from ActionType |
| `src/components/dilovod/ActionTags.tsx` | Update labels, remove `purchase.order`, update `sales.commission` desc |
| `src/components/dilovod/DraftCard.tsx` | Update chainLabels and actionLabels |
| `src/components/dilovod/ConfirmationMessage.tsx` | Add `expense_invoice_id` label |
| `src/components/dilovod/ChatThread.tsx` | Add typing indicator for streaming |
| `supabase/functions/dilovod-proxy/index.ts` | Update commission chain (replace comReport with expense invoice), remove purchase.order standalone handling |

