# Agentic AI for Dilovod — Implementation Plan v2

## Current State

- `dilovod-chat` edge function: simple prompt → stream response. AI guesses names, has zero catalog access.
- `draftResolver.ts` (client): resolves names post-hoc via dilovod-proxy. Fails on timeouts, single-threaded API bottleneck.
- Draft schema already has `dilovod_id` / `dilovod_name` fields — no schema change needed.
- `dilovod-proxy` already supports `searchCounterparty`, `searchItem`, `searchShipments`, `getObject` — reusable as-is.

---

## Architecture

The AI calls tools server-side during its thinking phase. The edge function runs an agentic loop (non-streaming tool iterations → streaming final response). The client sees no difference — same SSE stream, same draft JSON format.

```
User message
    ↓
dilovod-chat (edge function)
    ↓ AI thinks, calls tools
    ↓ search_counterparty("зелень") → internal fetch to dilovod-proxy → log immediately → results back to AI
    ↓ search_item("свічка київські каштани") → internal fetch → log immediately → results back to AI
    ↓ AI reasons: 1 counterparty found → auto-pick. 2 items found → ask user.
    ↓ AI produces final response with pre-resolved draft JSON (dilovod_ids filled in)
    ↓ stream: true for final response
    ↓
Client receives streamed text + draft JSON
    ↓
draftResolver.ts runs as SAFETY NET (skips fields where dilovod_id already set)

```

---

## Iteration Cap Math

Worst case: 1 counterparty search + 5 item searches + 1 shipment lookup = 7 tool call iterations. Cap at **8** gives headroom for 1 retry without risking infinite loops. On cap hit → force final response with `tool_choice: "none"`, `stream: true` → partial draft with unresolved fields goes through client-side fallback.

**Supabase edge function wall clock limit: 60 seconds.** Each Dilovod API call has up to 25s timeout. Sequential searches for 5 items = up to 125s theoretical maximum — which exceeds the limit.

Mitigation:

- Set per-tool-call timeout to **10 seconds** (not 25). Dilovod catalog searches are fast; 10s is generous.
- On tool timeout → return `{ "error": "timeout", "results": [] }` to the AI, not a thrown exception. AI continues with what it has, marks field as unresolved.
- This keeps worst case (8 tool calls × 10s) = 80s theoretical, but in practice catalog searches return in 1–3s. Real p99 stays well under 60s.

---

## Disambiguation Contract — Decided

**When the user responds to a disambiguation, the client resolves it directly — no second AI call.**

Rationale: the AI has already done its work. The user's selection is a data operation (fill in `dilovod_id`), not a reasoning task. Sending it back through the AI loop wastes an iteration, costs tokens, and introduces a failure point.

**Flow:**

1. AI returns draft with `candidates[]` and `dilovod_id: null` for ambiguous fields.
2. Client detects `candidates` array → renders DisambiguationCard.
3. User selects one option.
4. Client directly patches the draft in state: sets `dilovod_id` and `dilovod_name` from selected candidate, clears `candidates`.
5. If all fields now resolved → Approve button activates. No new AI call.
6. If other fields still unresolved → show next DisambiguationCard in sequence.

**Draft format for ambiguous field:**

```json
{
  "counterparty": {
    "extracted_name": "зелень",
    "dilovod_id": null,
    "dilovod_name": null,
    "candidates": [
      { "id": "123", "name": "Зелень, Львів", "code": "К-045" },
      { "id": "456", "name": "Зелень Плюс", "code": "К-089" }
    ]
  }
}

```

**Draft format for resolved field:**

```json
{
  "counterparty": {
    "extracted_name": "зелень",
    "dilovod_id": "456",
    "dilovod_name": "Зелень Плюс",
    "candidates": []
  }
}

```

---

## File Changes

### 1. `supabase/functions/dilovod-chat/index.ts` — Full rewrite

#### Tool definitions (Phase 1 — 5 tools)


| Tool                  | Arguments                                                    | Purpose                                |
| --------------------- | ------------------------------------------------------------ | -------------------------------------- |
| `search_counterparty` | `query: string`                                              | Find counterparty by partial name      |
| `search_item`         | `query: string`                                              | Find item/product by partial name      |
| `search_shipments`    | `counterpartyId: string, dateFrom?: string, dateTo?: string` | Find shipments for return processing   |
| `get_object`          | `id: string`                                                 | Get full details of any Dilovod object |
| `get_product_spec`    | `itemId: string`                                             | Check production specification         |


#### Tool executor

Internal fetch to `${SUPABASE_URL}/functions/v1/dilovod-proxy` using `SUPABASE_SERVICE_ROLE_KEY` as Bearer token. Server-to-server, no client timeouts, no CORS.

```typescript
async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000); // 10s hard cap

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/dilovod-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ action: name, params: args }),
      signal: controller.signal,
    });
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") {
      return { error: "timeout", results: [] }; // AI continues, field stays unresolved
    }
    return { error: String(e), results: [] };
  } finally {
    clearTimeout(timeout);
  }
}

```

#### Audit logging — per tool call, not after loop

**Critical:** log each tool call immediately after execution, before feeding result back to the AI. If the edge function times out mid-loop, all completed tool calls are already logged.

```typescript
async function executeAndLog(
  toolName: string,
  args: Record<string, unknown>,
  sessionId: string
): Promise<unknown> {
  const result = await executeTool(toolName, args);

  // Log immediately — do not await, do not block the loop
  supabase.from("dilovod_audit_log").insert({
    session_id: sessionId,
    event_type: "ai_tool_call",
    payload_snapshot: { tool: toolName, args, result },
    created_at: new Date().toISOString(),
  }).then(() => {}).catch(() => {}); // fire and forget, never throw

  return result;
}

```

#### Agentic loop

```typescript
async function agenticLoop(messages: Message[], sessionId: string): Promise<ReadableStream> {
  let iteration = 0;
  const MAX_ITERATIONS = 8;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    const response = await ai.chat({
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
      stream: false,
    });

    if (!response.tool_calls || response.tool_calls.length === 0) {
      // No more tool calls — stream final response
      return ai.chat({ messages, tools: [], tool_choice: "none", stream: true });
    }

    // Execute all tool calls in this iteration
    const toolResults = await Promise.all(
      response.tool_calls.map(async (tc) => {
        const result = await executeAndLog(tc.name, tc.arguments, sessionId);
        return { tool_call_id: tc.id, result };
      })
    );

    // Append assistant message + tool results to message history
    messages.push({ role: "assistant", tool_calls: response.tool_calls });
    messages.push(...toolResults.map((tr) => ({
      role: "tool",
      tool_call_id: tr.tool_call_id,
      content: JSON.stringify(tr.result),
    })));
  }

  // Cap hit — force final response with whatever the AI has
  return ai.chat({
    messages,
    tools: [],
    tool_choice: "none",
    stream: true,
  });
}

```

Note: tool calls within one iteration run in `Promise.all` (parallel) — safe because they are independent searches. Across iterations they are sequential — required because each iteration's results inform the next AI decision.

#### System prompt changes

Remove:

```
Система сама знайде повну назву контрагента та товарів по частковій назві.

```

Add:

```
У тебе є інструменти для пошуку в каталозі Діловод. 

ПРАВИЛА:
1. ЗАВЖДИ використовуй search_counterparty перед створенням draft. Навіть якщо ім'я здається повним.
2. ЗАВЖДИ використовуй search_item для кожного товару окремо. Шукай по extracted_name.
3. Якщо search повертає 1 результат — використай його dilovod_id в draft. Не питай користувача.
4. Якщо search повертає 2+ результати — постав dilovod_id: null і заповни candidates[] всіма варіантами. Користувач обере.
5. Якщо search повертає 0 результатів — постав dilovod_id: null, candidates: [], і повідом користувача що не знайдено.
6. Якщо tool повертає { "error": "timeout" } — постав dilovod_id: null і продовжуй. Не зупиняйся.
7. Шукай кожен товар окремо — API не підтримує batch-пошук.
8. Після всіх пошуків — поверни draft JSON в форматі нижче. Не вигадуй dilovod_id.

ФОРМАТ DRAFT: [insert full draft schema here]

```

---

### 2. `src/lib/draftResolver.ts` — Safety net adaptation

**Changes to** `parseDraftFromText`**:**

- Handle new `candidates` field in counterparty and items
- If `dilovod_id` is already set → skip resolution for that field (already works)
- If `candidates` array exists and `dilovod_id` is null → convert to `Disambiguation` object for UI

**Changes to** `resolveDraft`**:**

- Skip fields where `dilovod_id` is already populated
- Only run search for fields where AI didn't resolve (true fallback, not double-pass)

**No other changes.** The safety net fires only for genuine AI misses.

---

### 3. `src/pages/Dilovod.tsx` — Disambiguation resolution

**Add to** `handleSend → onDone` **flow:**

```typescript
// After parseDraftFromText:
const hasAllResolved = draft.items.every(i => i.dilovod_id) && draft.counterparty.dilovod_id;
if (hasAllResolved) {
  // Skip resolveDraft entirely — AI pre-resolved everything
  setCurrentDraft(draft);
} else {
  // Run safety net only for unresolved fields
  const resolved = await resolveDraft(draft);
  setCurrentDraft(resolved);
}

```

**Add** `handleDisambiguationSelect`**:**

```typescript
function handleDisambiguationSelect(
  field: "counterparty" | "items",
  index: number | null,
  candidate: { id: string; name: string }
) {
  setCurrentDraft(prev => {
    const next = { ...prev };
    if (field === "counterparty") {
      next.counterparty = {
        ...next.counterparty,
        dilovod_id: candidate.id,
        dilovod_name: candidate.name,
        candidates: [],
      };
    } else {
      next.items = next.items.map((item, i) =>
        i === index
          ? { ...item, dilovod_id: candidate.id, dilovod_name: candidate.name, candidates: [] }
          : item
      );
    }
    return next;
  });
  // No AI call. No network request. Pure state update.
  // Approve button activates automatically when all dilovod_ids are filled.
}

```

Pass `handleDisambiguationSelect` to `DisambiguationCard` as `onSelect` prop.

**Approve button activation logic:**

```typescript
const canApprove = currentDraft &&
  currentDraft.counterparty.dilovod_id !== null &&
  currentDraft.items.every(i => i.dilovod_id !== null) &&
  currentDraft.total_sum > 0;

```

---

### 4. `supabase/config.toml` — Add entry

```toml
[functions.dilovod-chat]
verify_jwt = false

```

---

## What Stays the Same

- All UI components: `DraftCard`, `DisambiguationCard`, `ChatThread`, `ConfirmationMessage`
- Draft approval flow: `handleDraftApprove` → `createChain`
- `streamChat.ts` — no changes, same SSE parsing
- Database schema — no changes
- `dilovod-proxy` — no changes, called internally by `dilovod-chat`

---

## Failure Modes — All Handled


| Failure                      | Behavior                                                                  |
| ---------------------------- | ------------------------------------------------------------------------- |
| Tool returns 0 results       | AI sets `dilovod_id: null`, `candidates: []`, tells user                  |
| Tool returns 2+ results      | AI sets `candidates[]`, user picks via DisambiguationCard                 |
| Tool times out (>10s)        | Returns `{error:"timeout"}`, AI marks field unresolved, continues         |
| Iteration cap hit (8)        | Force final response, partial draft → client safety net handles remaining |
| Edge function crash mid-loop | All completed tool calls already logged (fire-and-forget per call)        |
| User selects disambiguation  | Client patches draft state directly, no AI call                           |
| AI invents a dilovod_id      | Safety net re-validates any ID it hasn't seen before                      |


---

## Phase 2 Extensions (not in scope now, defined for reference)

- `get_recent_purchase_price(itemId, supplierId)` — validate supplier price against history
- `check_stock(itemId)` — verify availability before order
- `get_commission_report(shipmentId)` — load existing report for amendment
- Batch disambiguation UI — resolve all ambiguous fields in one card instead of sequentially
- Tool call visualization in chat — show user what the AI searched (transparency)c