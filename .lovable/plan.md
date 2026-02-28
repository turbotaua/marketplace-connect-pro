

# Dilovod AI Portal -- Implementation Plan

## Context

This plan synthesizes the CTO's PRD with our actual tech stack (React + Supabase Edge Functions + Lovable AI). The CTO's PRD specifies Next.js + Python FastAPI + Claude -- we adapt everything to our stack while preserving all business logic requirements.

**Critical prerequisite:** `DILOVOD_API_KEY` secret is not configured. We cannot proceed with any Dilovod integration until it is provided.

---

## Architecture (adapted to our stack)

```text
┌──────────────────────────────────────────┐
│         React Frontend (/dilovod)        │
│  Chat Thread | File Upload | Action Tags │
│  Draft Card (editable) | Approve/Reject  │
└──────────────┬───────────────────────────┘
               │ supabase.functions.invoke()
┌──────────────▼───────────────────────────┐
│       Supabase Edge Functions            │
│                                          │
│  dilovod-proxy     → Dilovod API calls   │
│  dilovod-extract   → Lovable AI gateway  │
│  dilovod-chat      → Orchestration       │
└──────────────┬───────────────────────────┘
               │ POST https://api.dilovod.ua
               ▼
         Dilovod ERP
```

---

## Phase 0: Prerequisites (before any code)

1. **Request `DILOVOD_API_KEY` secret** from user
2. Confirm Dilovod base URL (`https://api.dilovod.ua`)
3. Confirm test data exists (at least 1 counterparty, 1 product in Dilovod)

Without the API key, the project cannot proceed past this point.

---

## Phase 1: Database Schema + Dilovod Proxy Edge Function

### Database (single migration)

**New tables:**

- `dilovod_sessions` -- id, user_id, created_at, last_active_at
- `dilovod_messages` -- id, session_id, role (user/assistant/system), content, metadata (jsonb), created_at
- `dilovod_drafts` -- id, session_id, user_id, action_type (text: sales.commission / sales.end_consumer / sales.return / purchase.goods / purchase.services), status (draft / needs_attention / approved / rejected / written / error), source_file_url, payload (jsonb), flags (text[]), dilovod_ids (jsonb), created_at, updated_at
- `dilovod_audit_log` -- id, draft_id, user_id, action_type, event_type (extracted / approved / written / rejected / error), source_file_url, payload_snapshot (jsonb), dilovod_ids (jsonb), error_message, created_at -- **append-only** (RLS: SELECT + INSERT only, no UPDATE/DELETE)
- `dilovod_catalog_cache` -- cache_key (text PK), value_json (jsonb), fetched_at, ttl_hours (default 24)

All tables get RLS policies using existing `is_admin()` function. Audit log gets INSERT+SELECT only (no UPDATE/DELETE).

### Edge Function: `dilovod-proxy`

Single edge function that wraps all Dilovod API calls. Actions exposed via `action` param in request body:

- `listMetadata` / `getMetadata` -- schema discovery
- `searchCounterparty(query)` -- `request` to `catalogs.partners` with LIKE filter
- `searchItem(query)` -- `request` to `catalogs.products` with LIKE filter
- `createSalesOrder(header, goods)` -- `call` method `saleOrderCreate`
- `createDocument(objectType, header)` -- `saveObject` for shipments, receipts, returns, invoices
- `getObject(id)` -- fetch single object
- `listAccounts()` -- fetch chart of accounts (cached)
- `listFirms()` -- fetch company entities (cached)

All requests go through `https://api.dilovod.ua` with POST, JSON body containing `version: "0.25"`, `key: DILOVOD_API_KEY`, `action`, `params`.

Implements caching: firms and accounts stored in `dilovod_catalog_cache` with 24h TTL.

---

## Phase 2: AI Extraction Edge Function

### Edge Function: `dilovod-extract`

Uses Lovable AI gateway (`google/gemini-2.5-flash`) with tool calling to extract structured data from uploaded documents.

**Input:** file content (text/parsed) + action_type
**Output:** Draft JSON matching the CTO's schema (counterparty, items, date, total_sum, confidence scores, flags)

Tool definitions for structured output (one per action type):
- `extract_commission_sale` -- counterparty, date, items[], total_sum, confidence{}
- `extract_end_consumer_sale` -- same structure
- `extract_purchase` -- supplier, date, invoice_number, items[] with account mapping (20/26/96), total_sum
- `extract_return` -- original_shipment_id, counterparty, items[] with return_qty

**Validation layer** (runs after extraction):
- Sum consistency: sum(qty * price) == total_sum (tolerance 0.01 UAH)
- Date format validation
- Required fields present
- Confidence < 0.7 -> field added to flags[]
- Items qty > 0

**Account mapping rules** (hardcoded, not AI-decided):
- Товари -> рахунок 20
- Продукція -> рахунок 26
- Послуги -> рахунок 96

---

## Phase 3: Matching Engine + Document Chain Logic

### Counterparty matching (in `dilovod-proxy`):

1. Normalize input (strip ТОВ/ФОП, normalize whitespace)
2. Exact match by ЄДРПОУ/ІПН (if available)
3. Exact match by name
4. Fuzzy match (LIKE `%query%`) -- return top candidates with scores
5. If 1 match > 0.85 score -> auto-select
6. If 2-5 candidates 0.60-0.85 -> return for user disambiguation
7. If 0 matches -> offer "Create new" (only if name + at least one identifier)

Same logic for item matching (by SKU -> by name -> fuzzy).

### Document chains (in `dilovod-proxy`, action `createChain`):

| Action Type | Chain |
|---|---|
| sales.commission | SalesOrder -> CustomerInvoice -> Shipment (type: Передача комісіонеру) |
| sales.end_consumer | SalesOrder -> Shipment |
| sales.return | ReturnFromBuyer (linked to existing shipment via basisDocument) |
| purchase.goods | GoodsReceipt (account 20) |
| purchase.services | GoodsReceipt (account 96) |

Each document in chain links to parent via `basisDocument` field. All created IDs returned and stored.

---

## Phase 4: Chat UI Page

### New route: `/dilovod`

Add to `src/App.tsx` router and `AdminLayout` sidebar nav (new icon: `MessageSquare`).

### Components to create:

- `src/pages/Dilovod.tsx` -- main page with chat layout
- `src/components/dilovod/ChatThread.tsx` -- message list (user messages, AI responses, draft cards, confirmations)
- `src/components/dilovod/ActionTags.tsx` -- 5 action buttons grouped under "Продажі" and "Закупівлі"
- `src/components/dilovod/FileUpload.tsx` -- drag-drop + button, accepts PDF/PNG/JPEG/XLS/CSV/DOCX
- `src/components/dilovod/DraftCard.tsx` -- editable table showing extracted data, counterparty, items, flags (yellow highlight for confidence < 0.7), Approve/Edit/Reject buttons
- `src/components/dilovod/DisambiguationCard.tsx` -- shows 3-5 counterparty/item candidates with "Select" buttons + "Create new" option
- `src/components/dilovod/ConfirmationMessage.tsx` -- shows created Dilovod document IDs after successful write

### Flow:
1. User uploads file + selects action tag (or AI auto-detects)
2. System calls `dilovod-extract` -> returns draft
3. Draft card rendered in chat with editable fields
4. Flagged fields (confidence < 0.7) highlighted with warning icon
5. If counterparty/item ambiguous -> disambiguation card shown
6. User clicks "Підтвердити" -> system validates, calls `dilovod-proxy` createChain -> returns IDs
7. Confirmation message with Dilovod document IDs
8. Audit log entry written automatically

---

## Phase 5: Storage Bucket + File Handling

Create `dilovod-uploads` storage bucket (private) for uploaded source documents. Files referenced in audit log for traceability.

---

## Phase 6: Approve -> Write Flow

### Edge Function: `dilovod-chat` (orchestrator)

Handles the full lifecycle:
1. Receive file + action_type
2. Call `dilovod-extract` for AI extraction
3. Call `dilovod-proxy` for counterparty/item matching
4. Store draft in `dilovod_drafts`
5. On approve: re-validate draft, call `dilovod-proxy` createChain, update draft with dilovod_ids, write audit_log
6. On reject: update draft status, write audit_log

**Idempotency:** check if draft already has dilovod_ids before writing (prevent double-submit).

---

## Files to Create/Modify

| File | Action |
|---|---|
| Migration SQL | Create 5 new tables + RLS + indexes |
| `supabase/functions/dilovod-proxy/index.ts` | Dilovod API wrapper |
| `supabase/functions/dilovod-extract/index.ts` | AI extraction via Lovable AI |
| `supabase/functions/dilovod-chat/index.ts` | Chat orchestration |
| `src/pages/Dilovod.tsx` | Chat page |
| `src/components/dilovod/ChatThread.tsx` | Message display |
| `src/components/dilovod/ActionTags.tsx` | 5 action buttons |
| `src/components/dilovod/DraftCard.tsx` | Editable draft card |
| `src/components/dilovod/DisambiguationCard.tsx` | Entity matching UI |
| `src/components/dilovod/FileUpload.tsx` | File upload |
| `src/components/dilovod/ConfirmationMessage.tsx` | Post-write confirmation |
| `src/components/AdminLayout.tsx` | Add "Діловод" nav item |
| `src/App.tsx` | Add `/dilovod` route |

---

## Blocker

**DILOVOD_API_KEY must be provided before implementation begins.** I will request this secret as the first step when you approve this plan.

