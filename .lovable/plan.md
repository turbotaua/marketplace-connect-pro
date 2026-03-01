

## Diagnosis

The logs confirm the root cause clearly:

1. Tools **are** being called — `search_counterparty` and `search_item` fire on iteration 1
2. They execute **in parallel** (`Promise.all` on line 636)
3. Dilovod API is **single-threaded** — the second request gets `"multithreadApiSession multithread api request blocked"` (500)
4. AI sees one empty result + one error, gives up

The fix is simple: execute tool calls **sequentially** instead of in parallel.

## Plan

### 1. `supabase/functions/dilovod-chat/index.ts` — Sequential tool execution

Replace the `Promise.all` block (lines 636-648) with a sequential `for...of` loop:

```typescript
const toolResults: { id: string; result: unknown }[] = [];
for (const tc of msg.tool_calls) {
  const args = typeof tc.function.arguments === "string"
    ? JSON.parse(tc.function.arguments)
    : tc.function.arguments;

  console.log(`[agentic] Executing tool: ${tc.function.name}(${JSON.stringify(args)})`);
  const result = await executeAndLog(tc.function.name, args, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId);
  console.log(`[agentic] Tool ${tc.function.name} returned ${JSON.stringify(result).slice(0, 200)}`);

  toolResults.push({ id: tc.id, result });
}
```

This ensures only one Dilovod API call is active at a time, preventing the `multithreadApiSession` error.

### 2. Redeploy `dilovod-chat`

No other changes needed. The proxy, UI, and prompt are all fine.

