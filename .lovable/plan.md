

# Gap Analysis: Business Workflows vs Current Implementation

## Your Actual Business Workflows (from instructions)

```text
SALES (ПРОДАЖІ):
1.1 Замовлення магазини (комісія)     → documents.salesOrders
1.2 Рахунок покупцю                   → documents.customerInvoices (на підставі 1.1)
1.3 Відвантаження → Передача комісіон. → documents.shipments, type change (на підставі 1.1)
1.4 Звіт по продажам комісіонера      → documents.commissionReport (на підставі 1.3)
1.5 Відвантаження кінцевим споживачам  → documents.shipments (на підставі 1.1)
1.6 Повернення покупців               → documents.returnFromBuyer (на підставі shipment)

PURCHASES (ЗАКУПІВЛІ):
2.1 Замовлення постачальникам         → documents.supplierOrders
2.2 Надходження товарів               → documents.goodsReceipt (на підставі 2.1 OR standalone)
2.3 Надходження послуг                → documents.goodsReceipt (same, nomenclature = service)

PRODUCTION (ВИРОБНИЦТВО):
3.1 Перевірка специфікації            → catalogs.products → tab "Специфікація"
3.2 Замовлення на виробництво         → documents.productionOrders + auto-fill from spec
```

## What We Have vs What's Missing

### Commission Chain (sales.commission)
**Current code (lines 185-224):** Order → Invoice → Shipment(transferToConsignee)
**Missing:**
- **Step 1.4: Звіт комісіонера** -- completely absent. Per your instructions, this is created from the Shipment, NOT from Order. Our chain stops at 3 docs, should be 4.
- `operationType: "transferToConsignee"` -- field name is UNVERIFIED. We guessed it. The Dilovod API might use a different field name (e.g., `shipmentType`, `documentType`, or an enum ID). This is the **#1 critical risk** -- if wrong, the entire commission chain produces incorrect documents.
- `basisDocument` field name -- also unverified. Could be `parentDocument`, `baseDocument`, etc.

### Purchases Chain
**Current code (lines 264-281):** Creates GoodsReceipt directly.
**Missing:**
- **Step 2.1: Замовлення постачальникам** -- not implemented at all. Your instructions show a two-step flow: SupplierOrder → GoodsReceipt (на підставі). We skip the supplier order entirely.
- No `documents.supplierOrders` support anywhere.
- The "OR standalone" path (create GoodsReceipt without order) exists but the linked path doesn't.

### Production
**Entirely missing.** Not in action types, not in UI, not in proxy. Your instructions describe:
- Checking product specifications in catalog
- Creating production orders with auto-fill from specs
- Account 26 mapping for production items

### Return Chain  
**Current code (lines 250-262):** Creates ReturnFromBuyer.
**Issue:** Per your instructions (1.6), the return is created "на підставі" a Shipment (Відвантаження). Our code takes `originalShipmentId` from the draft, which is correct in principle, but there's no UI flow to search/select an existing shipment.

---

## Critical Errors from a Financial Perspective

### 1. Incomplete Commission Chain = Accounting Gap
Missing "Звіт комісіонера" means commission revenue is never formally recognized. In Ukrainian accounting, without the commission report, the transfer to consignee has no closing document. The goods sit in transit limbo -- they're shipped but revenue isn't recorded. **This breaks the P&L.**

### 2. No Supplier Orders = Broken Procurement Audit Trail
Skipping "Замовлення постачальникам" means goods receipts have no basis document. In a tax audit, the inspector will ask "where is the order?" The goods receipt needs to reference it via `basisDocument`. Without it, the chain is broken and the receipt looks like it appeared from nowhere.

### 3. Unverified API Field Names = Risk of Invalid Documents
`operationType: "transferToConsignee"` and `basisDocument` are guesses. If the actual Dilovod field is different, we create standard shipments instead of commission transfers. The accounting consequence: goods are recorded as SOLD (revenue + cost of goods sold) instead of TRANSFERRED ON COMMISSION (no revenue yet, goods remain on your balance sheet under account 28). **This misreports revenue and inventory.**

### 4. No Account Validation in Chain Creation
The proxy's `createChain` doesn't pass `account` for commission items. Commission goods should stay on account 28 (goods on commission) until the commission report. Our code doesn't enforce this.

### 5. Missing Production = Account 26 Gap
Production items (рахунок 26) can't flow through the system. If someone creates a goods receipt for production inputs, there's no way to then create a production order that consumes those inputs and outputs finished goods.

### 6. No `saveType` Verification
We use `saveType: "new"` everywhere. But for the "створити на підставі" pattern, Dilovod might require a different save mechanism. Some ERPs use the basis document to auto-populate fields -- if we pass raw fields instead, we might miss required auto-calculated values (taxes, discounts, warehouse assignments).

---

## Recommended Fixes (Priority Order)

### P0 -- Must fix before any real use

1. **API Spike: Verify field names.** Call `getMetadata` for `documents.shipments` to find the exact field for commission transfer type and basis document linking. Without this, nothing else matters.

2. **Add "Звіт комісіонера" to commission chain.** Make it step 4: after creating the shipment (Transfer to Consignee), create `documents.commissionReport` based on that shipment. Update `chainLabels` in DraftCard to show 4 steps.

3. **Add supplier orders to purchase flow.** Two paths:
   - Path A: SupplierOrder → GoodsReceipt (linked via basisDocument)  
   - Path B: GoodsReceipt standalone (no basis)
   - UI should ask which path. Add `purchase.order` action type or a toggle.

### P1 -- Important for correctness

4. **Add production action type.** New ActionType `production.order`. Chain: check product specification → create production order → auto-fill from spec. Account 26 for all production items.

5. **Add shipment search for returns.** UI component that searches existing shipments by counterparty/date before creating return. Currently the user has no way to find the shipment ID.

6. **Pass account IDs in commission chain.** Commission goods should reference account 28, not default.

### P2 -- Hardening

7. **Add rollback on chain failure.** If step 2 of a 4-step chain fails, step 1 is orphaned in Dilovod. Should `setDelMark` on created documents if a later step fails.

8. **Add sequential write queue.** Dilovod API is single-threaded per key. Concurrent requests can cause data corruption.

---

## Implementation Plan

### Step 1: API Discovery (edge function changes)
- Add `getMetadata` calls for `documents.shipments`, `documents.commissionReport`, `documents.supplierOrders` to discover exact field names
- Test with real data, log responses, update field names in proxy

### Step 2: Fix Commission Chain
- Add step 4 (commissionReport) to `createChain` for `sales.commission`
- Update `chainLabels` in DraftCard: `["Замовлення", "Рахунок", "Передача комісіонеру", "Звіт комісіонера"]`
- Update `ConfirmationMessage` to show `commission_report_id`

### Step 3: Add Supplier Orders
- Add `createSupplierOrder` action in proxy
- Update `purchase.goods` chain: optionally create SupplierOrder first, then GoodsReceipt linked to it
- Add ActionType `purchase.order` or add a toggle in UI for "з замовленням / без замовлення"

### Step 4: Add Production Support
- Add ActionType `production.order` 
- Add production chain logic in proxy
- Add spec checking (read product, verify specification tab populated)
- Add UI tag under new "Виробництво" group

### Step 5: Add Shipment Search for Returns
- New proxy action `searchShipments(counterpartyId, dateFrom, dateTo)`
- UI component in chat to search and select existing shipment before creating return

### Step 6: Chain Rollback
- Wrap chain creation in try/catch per step
- On failure, `setDelMark` on all previously created documents in that chain
- Return partial result with error details

