

## Problem Analysis

From the screenshot and network logs, I identified two bugs:

1. **Duplicate messages sent**: Two identical POST requests fire to `dilovod-chat` simultaneously. The `handleSend` callback depends on `messages` in its dependency array, but `saveMessage` mutates `messages` — causing React to re-create the callback mid-execution, leading to double invocation.

2. **Infinite spinner after AI responds**: The AI response streams back fine (200 OK), but then `resolveDraft()` calls `dilovod-proxy` → external Dilovod API with **no timeout**. If the API is slow or unresponsive, the spinner stays forever. There's also no error handling visible to the user.

## Fix Plan

### 1. Fix duplicate sends in `Dilovod.tsx`

- Use a `useRef` for the processing flag instead of `useState` — refs don't cause re-renders and can't go stale in closures
- Remove `messages` from `handleSend` dependency array — capture current messages via `setMessages` callback or a ref
- Add a `sendingRef` that's checked synchronously to prevent double-entry

### 2. Add timeout to `draftResolver.ts`

- Wrap each `callProxy` fetch with `AbortController` + 10s timeout
- If proxy times out, return empty candidates (don't block the entire flow)
- Add overall `resolveDraft` timeout of 15s — if exceeded, save message as plain text

### 3. Add timeout to `callDilovod` in `dilovod-proxy/index.ts`

- Add `AbortController` with 15s timeout to the external Dilovod API fetch
- Return a clear error message on timeout

### 4. Better error feedback in `Dilovod.tsx`

- If `resolveDraft` fails or times out, show toast with message and save assistant response as plain text (not lost)
- Ensure `setIsProcessing(false)` is called in all error paths

### Files to Change

| File | Change |
|---|---|
| `src/pages/Dilovod.tsx` | Use ref for processing guard, fix `handleSend` deps to prevent double-fire |
| `src/lib/draftResolver.ts` | Add 10s timeout per proxy call, 15s overall timeout |
| `supabase/functions/dilovod-proxy/index.ts` | Add 15s timeout to `callDilovod` fetch |

