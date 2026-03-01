## Plan: Add `query_dilovod` Meta-Tool + Add to System Prompt

Two changes to `dilovod-chat/index.ts`, one to `dilovod-proxy/index.ts`. No UI changes needed — the AI's analytics answers come back as regular markdown text in the chat stream.

### 1. `supabase/functions/dilovod-proxy/index.ts` — Add `queryDilovod` passthrough action

New case before the `default:` block. It forwards any valid Dilovod API `action` + `params` directly through `callDilovod`. This gives the AI arbitrary read access to the entire Dilovod API (catalogs, registers, documents, turnover, balances).

```typescript
case "queryDilovod": {
  const dilovodAction = params.action || "request";
  const dilovodParams = params.params || {};
  result = await callDilovod(apiKey, dilovodAction, dilovodParams);
  break;
}
```

Safety: the Dilovod API key has read-only access to registers/catalogs by design; write operations (`saveObject`, `setDelMark`) require explicit action names that the AI won't use in analytics mode. The proxy already has a separate `createChain`/`createDocument`/`setDelMark` for writes.

### 2. `supabase/functions/dilovod-chat/index.ts` — Add tool definition + mapping

Add one new tool to `TOOL_DEFINITIONS`:

```typescript
{
  type: "function",
  function: {
    name: "query_dilovod",
    description: "Виконує довільний запит до Dilovod API. Використовуй для аналітичних запитів: залишки, обороти, борги, ціни, ABC-аналіз тощо. Параметр action зазвичай 'request'. Параметр params містить from, fields, filters, limit.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Dilovod API action (зазвичай 'request')" },
        params: { type: "object", description: "Параметри запиту: from, fields, filters, limit тощо" },
      },
      required: ["action", "params"],
    },
  },
}
```

Add to `TOOL_TO_ACTION`:

```typescript
query_dilovod: "queryDilovod",
```

### 3. `supabase/functions/dilovod-chat/index.ts` — Replace to extend `SYSTEM_PROMPT`

Replace the entire `SYSTEM_PROMPT` constant (lines 111–212) with the user-provided dual-mode prompt. This is a straight replacement — the new prompt covers:

- **Mode 1 (Document processing)**: same rules as before but with real Dilovod field names and entity types from the actual schema
- **Mode 2 (Analytics)**: teaches the AI how to construct `query_dilovod` calls for balance registers, turnover registers, price registers, etc.
- **Full data schema**: all catalogs, documents, registers with real field names
- **Query rules**: filter operators, ID format, `assembleLinks`, table part queries

The existing tool search rules (1–10) are preserved within Mode 1. The `query_dilovod` tool is used exclusively in Mode 2.

### 4. Deploy both functions

Both `dilovod-proxy` and `dilovod-chat` need redeployment.

### What stays the same

- All UI components, draft parsing, disambiguation flow
- All existing tools (`search_counterparty`, `search_item`, etc.) — still used in Mode 1
- `streamChat.ts`, `draftResolver.ts`, `Dilovod.tsx` — zero changes
- The agentic loop structure (8 iterations, 10s timeout per tool)