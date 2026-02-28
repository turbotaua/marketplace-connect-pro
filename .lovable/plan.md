

## Problem: resolveDraft times out — items never get searched, disambiguation never shown

### Root causes (confirmed by code review)

1. **`callProxy` retries on ALL nulls** (line 180-185) — even when API returns empty results (no matches). So a counterparty search "Тест Тестинг" → empty → retry → empty = 70s wasted (2×35s) before items even start.

2. **Sequential execution** (line 320-351): counterparty finishes first (up to 70s with retries), then items start. By then, 60s `Promise.race` fires.

3. **`smartSearch` fallback words** for counterparty tries each word sequentially (line 256-261), each with 35s timeout + retry = up to 140s for a 2-word name.

4. **No partial results**: if `resolveDraft` throws or times out, the entire draft is lost → "Відповідь збережено як текст".

---

### Fix plan (4 changes, 2 files)

**1. `src/lib/draftResolver.ts` — Remove retry-on-empty, only retry on network errors**

`callProxy`: distinguish between `null` (network/timeout error) and empty results (API returned `[]`). Only retry on actual errors, not on empty results. Return type changes to differentiate "error" from "no results".

**2. `src/lib/draftResolver.ts` — Run counterparty + items in parallel**

Change `resolveDraft` to fire counterparty and all items concurrently using `Promise.allSettled` with a concurrency limiter (max 2 in-flight). This way items don't wait for counterparty.

**3. `src/lib/draftResolver.ts` — resolveDraft never throws**

Wrap each individual search in try/catch. If counterparty search fails → flag it, continue with items. If an item search fails → flag that item, continue. Always return `ResolveResult` with partial data + disambiguations.

**4. `src/pages/Dilovod.tsx` — Remove Promise.race timeout, always show partial draft**

Since `resolveDraft` now never throws, remove the 60s `Promise.race` wrapper. Always show the draft card — flagged fields show "needs selection" instead of hiding the entire draft.

Reduce `callProxy` timeout from 35s → 12s (one search should complete in under 10s; if not, it's stuck). Remove the retry wrapper entirely — if a search fails, flag it and move on.

---

### Concrete changes

| File | What changes |
|---|---|
| `src/lib/draftResolver.ts` | `callProxy`: timeout 35s→12s, remove auto-retry. `resolveDraft`: parallel `Promise.allSettled` for counterparty+items, each wrapped in try/catch, always returns partial result. `smartSearch` fallback: max 1 word, no retry. |
| `src/pages/Dilovod.tsx` | Remove `Promise.race` 60s wrapper. Remove try/catch that reverts to plain text. Always show draft/disambiguation. |

