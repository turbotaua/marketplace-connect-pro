

## Problem: Counterparty search fails on multi-word names

The Dilovod API `%` operator does **exact substring** matching. "Зелень Львів" → 0 results, but "зелень" alone → finds "Зелень, Львів". The AI often extracts names without punctuation (commas, dots), so multi-word searches fail silently.

Current `smartSearch` for counterparties only tries:
1. Full normalized query → fails if punctuation differs
2. Fallback: first distinctive word → works but only triggers if step 1 returns 0

### Fix: Multi-strategy counterparty search

**File: `src/lib/draftResolver.ts`** — rewrite `smartSearch` for counterparties:

1. **Strategy 1**: Search the full normalized name (current behavior)
2. **Strategy 2**: If the query has 2+ words, search **each word in parallel** and merge/deduplicate results — so "Зелень Львів" searches "Зелень" AND "Львів" simultaneously, both find the same counterparty
3. **Strategy 3**: Fallback to first distinctive word (current behavior, already exists)
4. Run strategies 1+2 in parallel (`Promise.all`), only fall back to 3 if both return 0

**Scoring improvements** in `calculateMatchScore`:
- Strip commas, dots, dashes before comparing (`normalizeForCompare` already strips quotes, add `,.-`)
- Add word-overlap scoring that ignores punctuation: "Зелень Львів" vs "Зелень, Львів" should score ~1.0

### Changes

| File | Change |
|---|---|
| `src/lib/draftResolver.ts` | `smartSearch`: for counterparties, search each word in parallel and merge results. Improve `normalizeForCompare` to strip commas/dots. |

