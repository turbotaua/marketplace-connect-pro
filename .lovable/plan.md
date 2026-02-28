

## Fix: Smart Search Normalization + Timeout Tuning

### Root cause (confirmed by direct proxy test)
- `POST /dilovod-proxy {"action":"searchItem","params":{"query":"каштан"}}` returns 10 results in ~3s
- But draftResolver sends `"query":"Свічка Київські Каштани"` — too specific, and the 10s client timeout kills the request before Dilovod responds

### Changes

**1. `src/lib/draftResolver.ts` — Smart query normalization + multi-strategy search**

- Add `normalizeSearchQuery(query, type)`:
  - Strip product-type prefixes: "свічка", "дифузор", "аромаспрей", "набір" etc.
  - Strip quotes `«»""''`
  - Trim, lowercase
  - For items: extract the distinctive name part ("Київські Каштани")
  
- Replace single `searchCatalog()` call with `smartSearch()`:
  - Strategy 1: search with normalized full name ("київські каштани")
  - Strategy 2 (if 0 results): search with shortest distinctive word ("каштан") 
  - Merge and deduplicate results

- Increase `callProxy` timeout from 10s → 20s (Dilovod API is genuinely slow)
- Increase overall `resolveDraft` race timeout in Dilovod.tsx from 15s → 25s

**2. `src/pages/Dilovod.tsx` — Increase resolution timeout**

- Change `Promise.race` timeout from 15000 → 25000ms

**3. Scoring improvements in `draftResolver.ts`**

- Normalize both query and candidate before comparison (strip type prefixes from candidate names too)
- Auto-resolve threshold: if top candidate score ≥ 0.85 (keep existing) but also auto-resolve if only 1 candidate even at lower score (≥ 0.7)

### Files

| File | Change |
|---|---|
| `src/lib/draftResolver.ts` | Add `normalizeSearchQuery`, multi-strategy search, 20s timeout |
| `src/pages/Dilovod.tsx` | Increase resolution timeout to 25s |

