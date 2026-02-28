

## Problem: Search Times Out Due to Parallel API Overload

### Root Cause (confirmed)
The search query "Київські Каштани" **does return results** (10 items found in direct test). The problem is purely a timeout caused by **too many concurrent requests** hitting the slow Dilovod API:

- `resolveDraft` fires counterparty + all items searches **in parallel** (`Promise.all`)
- Counterparty "Тест Тестинг" alone makes 3 sequential API calls (original → "тест" → "тестинг")  
- Meanwhile item search fires simultaneously
- Dilovod API queues/rate-limits → everything exceeds 20s client timeout → "Не вдалося знайти товари"

### Fix Plan

**1. `supabase/functions/dilovod-proxy/index.ts` — Increase Dilovod API timeout**
- Change `callDilovod` timeout from 15s → 25s (API is genuinely slow)

**2. `src/lib/draftResolver.ts` — Serialize requests + increase client timeout + retry**
- Increase `callProxy` timeout from 20s → 35s
- Add 1x retry on timeout in `callProxy`
- Change `resolveDraft`: resolve counterparty FIRST, then items **sequentially** (not `Promise.all`) to avoid overwhelming the Dilovod API
- For items with 3+ entries: batch 2 at a time max

**3. `src/pages/Dilovod.tsx` — Increase resolution timeout**
- Change `Promise.race` timeout from 25s → 60s (counterparty + N items sequentially needs more time)

### Files

| File | Change |
|---|---|
| `supabase/functions/dilovod-proxy/index.ts` | Dilovod timeout 15s → 25s |
| `src/lib/draftResolver.ts` | Client timeout 20s → 35s, retry 1x, serialize API calls |
| `src/pages/Dilovod.tsx` | Resolution timeout 25s → 60s |

