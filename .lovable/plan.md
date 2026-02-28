

## Problem

Two issues:
1. **Search works but scoring is wrong for partial matches** — "зелень" finds "Зелень, Львів" via API (`%` operator), but `calculateMatchScore("зелень", "Зелень, Львів")` returns 0.9 which auto-resolves without asking. If there are multiple counterparties containing "зелень", user never sees them. The threshold (0.85) is too aggressive for short/partial queries.
2. **Disambiguation UI is basic** — current `DisambiguationCard` uses plain buttons in a yellow-bordered card. User wants Lovable-style quiz cards: clean, inline, with radio-button feel.

## Plan (2 files)

### 1. `src/lib/draftResolver.ts` — Smarter auto-resolve for short queries

When the search query is significantly shorter than the best candidate's name (e.g. "зелень" vs "Зелень, Львів"), **always show disambiguation** instead of auto-resolving. This prevents silently picking the wrong counterparty when the user gave a partial name.

Changes to `resolveField`:
- If the normalized query is ≤ 1 word and there are multiple candidates, **always return disambiguation** regardless of score
- Only auto-resolve single-word queries if there's exactly 1 candidate with score ≥ 0.9

### 2. `src/components/dilovod/DisambiguationCard.tsx` — Quiz-style UI

Redesign the disambiguation card to match a modern quiz/poll UI:
- Clean white card with subtle border (no yellow warning color)
- Question header: "Який контрагент?" / "Який товар?"
- Radio-button style options with name, code, and match percentage as a subtle badge
- Hover highlight, selected state
- "Створити нового" as a text link at the bottom
- Compact, inline in the chat bubble

