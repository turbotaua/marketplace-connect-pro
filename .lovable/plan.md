

## Plan: Catalog Resolution — Search Real Products & Counterparties Before Draft

### Problem
AI returns `extracted_name` fields that don't match actual Dilovod catalog entries. This creates duplicate items. Need to search real Dilovod catalog and resolve names to real IDs before finalizing the draft.

### Architecture

```text
User message → AI streams response with draft JSON
→ Frontend parses draft from AI response
→ For each extracted_name (items + counterparty):
   call dilovod-proxy searchItem / searchCounterparty
→ If 1 match with high confidence → auto-resolve (set dilovod_id)
→ If multiple matches → show DisambiguationCard inline
→ If 0 matches → show warning, offer "create new"
→ Only after all resolved → show final DraftCard with real IDs
```

### Files to Change

| File | What |
|---|---|
| `src/lib/draftResolver.ts` | **New** — parse draft JSON from AI text, call proxy to resolve each name, return resolved draft + disambiguation needs |
| `src/pages/Dilovod.tsx` | After streaming completes, detect draft JSON in response, run resolver, show disambiguation or resolved draft |
| `src/components/dilovod/ChatThread.tsx` | Render DisambiguationCard for unresolved items inline in chat |
| `src/components/dilovod/DisambiguationCard.tsx` | Minor updates — support item vs counterparty type, callback with full candidate data |
| `src/components/dilovod/DraftCard.tsx` | Show resolved names (from Dilovod) alongside extracted names, show ✓ for resolved items |

### Draft Resolution Logic (`draftResolver.ts`)

1. `parseDraftFromText(text: string)` — regex to find ```json blocks with `"type": "draft"`, parse them
2. `resolveDraft(draft)` — for each `item.extracted_name`, call `POST /dilovod-proxy` with `{ action: "searchItem", params: { query: name } }`. For `counterparty.extracted_name`, call `searchCounterparty`.
3. Return `{ resolvedDraft, disambiguations: [{field, extractedName, candidates}] }`
4. Scoring: if top result name contains the search query (case-insensitive) and only 1 result → auto-resolve. Otherwise → disambiguation.

### UX Flow

1. AI responds with draft JSON in markdown
2. Frontend detects it, shows "🔍 Пошук у каталозі Діловод..." indicator
3. For each resolved item → ✓ icon + real Dilovod name
4. For each ambiguous item → DisambiguationCard with candidates from Dilovod
5. User clicks candidate → item resolved, card collapses
6. When all items + counterparty resolved → DraftCard becomes actionable (can submit)

### Proxy Calls (already exist)

- `searchItem`: `{ action: "searchItem", params: { query: "свічки каштани" } }` → returns `[{id, name, code}]`
- `searchCounterparty`: `{ action: "searchCounterparty", params: { query: "Тест Тестинг" } }` → returns `[{id, name, code}]`

No backend changes needed — proxy already supports these searches.

