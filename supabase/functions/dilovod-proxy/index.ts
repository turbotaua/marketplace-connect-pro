import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DILOVOD_URL = "https://api.dilovod.ua";
const DILOVOD_VERSION = "0.25";

// Dilovod docMode IDs for documents.sale
const DOC_MODE = {
  goods: "1004000000000350",       // Відвантаження покупцеві
  services: "1004000000000351",    // Надання послуг
  commission: "1004000000000352",  // Передача комісіонеру
  comReport: "1004000000000353",   // Звіт комісіонера
} as const;

async function callDilovod(apiKey: string, action: string, params: Record<string, unknown>) {
  const packet = { version: DILOVOD_VERSION, key: apiKey, action, params };
  console.log(`[dilovod-proxy] calling action=${action}`);
  const res = await fetch(DILOVOD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(packet),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dilovod HTTP ${res.status}: ${text}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`Dilovod API error: ${JSON.stringify(data.error)}`);
  }
  return data;
}

// Rollback helper: soft-delete previously created docs on chain failure
async function rollbackChain(apiKey: string, chainIds: Record<string, string>) {
  for (const [key, id] of Object.entries(chainIds)) {
    try {
      console.log(`[dilovod-proxy] rollback: deleting ${key}=${id}`);
      await callDilovod(apiKey, "setDelMark", { header: { id } });
    } catch (e) {
      console.error(`[dilovod-proxy] rollback failed for ${key}=${id}:`, e);
    }
  }
}

function extractId(result: any): string {
  if (typeof result === "string") return result;
  if (typeof result === "number") return String(result);
  return result?.result?.id || result?.id || result?.result || String(result);
}

// Cache helpers
async function getCached(supabase: any, key: string) {
  const { data } = await supabase
    .from("dilovod_catalog_cache")
    .select("*")
    .eq("cache_key", key)
    .single();
  if (!data) return null;
  const age = (Date.now() - new Date(data.fetched_at).getTime()) / 3600000;
  if (age > data.ttl_hours) return null;
  return data.value_json;
}

async function setCache(supabase: any, key: string, value: unknown) {
  await supabase.from("dilovod_catalog_cache").upsert({
    cache_key: key,
    value_json: value,
    fetched_at: new Date().toISOString(),
    ttl_hours: 24,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("DILOVOD_API_KEY");
    if (!apiKey) throw new Error("DILOVOD_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { action, params = {} } = body;

    let result: unknown;

    switch (action) {
      // Schema discovery
      case "listMetadata": {
        result = await callDilovod(apiKey, "listMetadata", { lang: params.lang || "uk" });
        break;
      }
      case "getMetadata": {
        result = await callDilovod(apiKey, "getMetadata", {
          objectName: params.objectType || params.objectName,
          lang: params.lang || "uk",
        });
        break;
      }

      // Search counterparties (catalogs.persons)
      case "searchCounterparty": {
        const query = params.query || "";
        const filters: Record<string, unknown>[] = [];
        if (query) {
          filters.push({ alias: "person_name", operator: "%", value: query });
        }
        result = await callDilovod(apiKey, "request", {
          from: "catalogs.persons",
          fields: { id: "person_id", name: "person_name", code: "person_code" },
          filters,
          limit: params.limit || 20,
        });
        break;
      }

      // Search items (catalogs.goods)
      case "searchItem": {
        const query = params.query || "";
        const filters: Record<string, unknown>[] = [];
        if (query) {
          filters.push({ alias: "item_name", operator: "%", value: query });
        }
        result = await callDilovod(apiKey, "request", {
          from: "catalogs.goods",
          fields: { id: "item_id", name: "item_name", code: "item_code" },
          filters,
          limit: params.limit || 20,
        });
        break;
      }

      // Search shipments (documents.sale) for returns
      case "searchShipments": {
        const filters: Record<string, unknown>[] = [];
        if (params.counterpartyId) {
          filters.push({ alias: "person", operator: "=", value: params.counterpartyId });
        }
        if (params.dateFrom) {
          filters.push({ alias: "doc_date", operator: ">=", value: params.dateFrom });
        }
        if (params.dateTo) {
          filters.push({ alias: "doc_date", operator: "<=", value: params.dateTo });
        }
        result = await callDilovod(apiKey, "request", {
          from: "documents.sale",
          fields: {
            id: "doc_id",
            date: "doc_date",
            number: "doc_number",
            person: "person",
            "person.name": "person_name",
            amountCur: "amount",
            docMode: "docMode",
          },
          filters,
          limit: params.limit || 50,
        });
        break;
      }

      // Get single object
      case "getObject": {
        result = await callDilovod(apiKey, "getObject", { id: params.id });
        break;
      }

      // List accounts (cached)
      case "listAccounts": {
        const cached = await getCached(supabase, "accounts");
        if (cached) {
          result = cached;
        } else {
          result = await callDilovod(apiKey, "request", {
            from: "catalogs.accounts",
            fields: { id: "acc_id", code: "acc_code", name: "acc_name" },
            limit: 200,
          });
          await setCache(supabase, "accounts", result);
        }
        break;
      }

      // List firms (cached)
      case "listFirms": {
        const cached = await getCached(supabase, "firms");
        if (cached) {
          result = cached;
        } else {
          result = await callDilovod(apiKey, "request", {
            from: "catalogs.firms",
            fields: { id: "firm_id", name: "firm_name" },
            limit: 50,
          });
          await setCache(supabase, "firms", result);
        }
        break;
      }

      // Create sales order via specialized method
      case "createSalesOrder": {
        result = await callDilovod(apiKey, "call", {
          method: "saleOrderCreate",
          arguments: {
            header: params.header,
            goods: params.goods,
            placement: params.placement || { autoPlacement: true },
          },
        });
        break;
      }

      // Create/save any document (universal)
      case "createDocument": {
        result = await callDilovod(apiKey, "saveObject", {
          saveType: params.saveType ?? 1, // 0=save, 1=register(post), 2=unregister
          header: {
            id: params.objectType,
            ...params.header,
          },
          ...(params.tableParts ? { tableParts: params.tableParts } : {}),
        });
        break;
      }

      // ===== CHAIN CREATION =====
      case "createChain": {
        const { actionType, draft } = params;
        const chainIds: Record<string, string> = {};

        try {
          if (actionType === "sales.commission") {
            // Step 1: Sales Order (saleOrderCreate)
            const order = await callDilovod(apiKey, "call", {
              method: "saleOrderCreate",
              arguments: {
                header: { firm: draft.firmId, person: draft.counterpartyId, date: draft.date },
                goods: draft.items.map((i: any) => ({ good: i.dilovod_id, qty: i.qty, price: i.price })),
                placement: { autoPlacement: true },
              },
            });
            chainIds.order_id = extractId(order);

            // Step 2: Customer Invoice (documents.saleInvoice)
            const invoice = await callDilovod(apiKey, "saveObject", {
              saveType: 1,
              header: {
                id: "documents.saleInvoice",
                firm: draft.firmId,
                person: draft.counterpartyId,
                date: draft.date,
                baseDoc: chainIds.order_id,
              },
              tableParts: {
                tpGoods: draft.items.map((i: any, idx: number) => ({
                  rowNum: idx + 1,
                  good: i.dilovod_id,
                  qty: i.qty,
                  price: i.price,
                  amountCur: i.total || i.qty * i.price,
                })),
              },
            });
            chainIds.invoice_id = extractId(invoice);

            // Step 3: Transfer to Consignee (documents.sale, docMode=commission)
            const transfer = await callDilovod(apiKey, "saveObject", {
              saveType: 1,
              header: {
                id: "documents.sale",
                firm: draft.firmId,
                person: draft.counterpartyId,
                date: draft.date,
                baseDoc: chainIds.order_id,
                docMode: DOC_MODE.commission,
              },
              tableParts: {
                tpGoods: draft.items.map((i: any, idx: number) => ({
                  rowNum: idx + 1,
                  good: i.dilovod_id,
                  qty: i.qty,
                  price: i.price,
                  amountCur: i.total || i.qty * i.price,
                })),
              },
            });
            chainIds.transfer_id = extractId(transfer);

            // Step 4: Expense Invoice / Видаткова накладна (documents.sale, docMode=goods)
            const expenseInvoice = await callDilovod(apiKey, "saveObject", {
              saveType: 1,
              header: {
                id: "documents.sale",
                firm: draft.firmId,
                person: draft.counterpartyId,
                date: draft.date,
                baseDoc: chainIds.order_id,
                docMode: DOC_MODE.goods,
              },
              tableParts: {
                tpGoods: draft.items.map((i: any, idx: number) => ({
                  rowNum: idx + 1,
                  good: i.dilovod_id,
                  qty: i.qty,
                  price: i.price,
                  amountCur: i.total || i.qty * i.price,
                })),
              },
            });
            chainIds.expense_invoice_id = extractId(expenseInvoice);

          } else if (actionType === "sales.end_consumer") {
            // Step 1: Sales Order
            const order = await callDilovod(apiKey, "call", {
              method: "saleOrderCreate",
              arguments: {
                header: { firm: draft.firmId, person: draft.counterpartyId, date: draft.date },
                goods: draft.items.map((i: any) => ({ good: i.dilovod_id, qty: i.qty, price: i.price })),
                placement: { autoPlacement: true },
              },
            });
            chainIds.order_id = extractId(order);

            // Step 2: Shipment (documents.sale, docMode=goods)
            const sale = await callDilovod(apiKey, "saveObject", {
              saveType: 1,
              header: {
                id: "documents.sale",
                firm: draft.firmId,
                person: draft.counterpartyId,
                date: draft.date,
                baseDoc: chainIds.order_id,
                docMode: DOC_MODE.goods,
              },
              tableParts: {
                tpGoods: draft.items.map((i: any, idx: number) => ({
                  rowNum: idx + 1,
                  good: i.dilovod_id,
                  qty: i.qty,
                  price: i.price,
                  amountCur: i.total || i.qty * i.price,
                })),
              },
            });
            chainIds.shipment_id = extractId(sale);

          } else if (actionType === "sales.return") {
            // Return from buyer (documents.saleReturn, baseDoc = original shipment)
            const ret = await callDilovod(apiKey, "saveObject", {
              saveType: 1,
              header: {
                id: "documents.saleReturn",
                firm: draft.firmId,
                person: draft.counterpartyId,
                date: draft.date,
                baseDoc: draft.originalShipmentId,
              },
              tableParts: {
                tpGoods: draft.items.map((i: any, idx: number) => ({
                  rowNum: idx + 1,
                  good: i.dilovod_id,
                  qty: i.return_qty || i.qty,
                  price: i.price,
                  amountCur: (i.return_qty || i.qty) * i.price,
                })),
              },
            });
            chainIds.return_id = extractId(ret);

          } else if (actionType === "purchase.receipt" || actionType === "purchase.goods" || actionType === "purchase.services") {
            // Optional Step 1: Supplier Order (documents.purchaseOrder)
            if (draft.createSupplierOrder) {
              const supplierOrder = await callDilovod(apiKey, "saveObject", {
                saveType: 1,
                header: {
                  id: "documents.purchaseOrder",
                  firm: draft.firmId,
                  person: draft.counterpartyId,
                  date: draft.date,
                },
                tableParts: {
                  tpGoods: draft.items.map((i: any, idx: number) => ({
                    rowNum: idx + 1,
                    good: i.dilovod_id,
                    qty: i.qty,
                    price: i.price,
                    amountCur: i.total || i.qty * i.price,
                  })),
                },
              });
              chainIds.supplier_order_id = extractId(supplierOrder);
            }

            // Step 2 (or 1): Goods Receipt (documents.purchase)
            const receipt = await callDilovod(apiKey, "saveObject", {
              saveType: 1,
              header: {
                id: "documents.purchase",
                firm: draft.firmId,
                person: draft.counterpartyId,
                date: draft.date,
                ...(chainIds.supplier_order_id ? { baseDoc: chainIds.supplier_order_id } : {}),
              },
              tableParts: {
                tpGoods: draft.items.map((i: any, idx: number) => ({
                  rowNum: idx + 1,
                  good: i.dilovod_id,
                  qty: i.qty,
                  price: i.price,
                  amountCur: i.total || i.qty * i.price,
                  ...(i.accountId ? { accGood: i.accountId } : {}),
                })),
              },
            });
            chainIds.receipt_id = extractId(receipt);

          } else if (actionType === "production.order") {
            // Production order (documents.prodOrder)
            const prodOrder = await callDilovod(apiKey, "saveObject", {
              saveType: 1,
              header: {
                id: "documents.prodOrder",
                firm: draft.firmId,
                date: draft.date,
                ...(draft.counterpartyId ? { person: draft.counterpartyId } : {}),
              },
              tableParts: {
                tpGoods: draft.items.map((i: any, idx: number) => ({
                  rowNum: idx + 1,
                  good: i.dilovod_id,
                  qty: i.qty,
                  ...(i.price ? { price: i.price, amountCur: i.total || i.qty * i.price } : {}),
                })),
              },
            });
            chainIds.prod_order_id = extractId(prodOrder);
          }
        } catch (chainError) {
          // Rollback all previously created documents
          if (Object.keys(chainIds).length > 0) {
            console.error(`[dilovod-proxy] chain failed at step, rolling back ${Object.keys(chainIds).length} docs`);
            await rollbackChain(apiKey, chainIds);
          }
          throw chainError;
        }

        result = { chainIds };
        break;
      }

      // Check product specification
      case "getProductSpec": {
        const product = await callDilovod(apiKey, "getObject", { id: params.productId });
        result = {
          product,
          hasSpecification: !!(product?.tableParts?.tpSpecification?.length > 0 ||
                               product?.result?.tableParts?.tpSpecification?.length > 0),
        };
        break;
      }

      // Soft delete
      case "setDelMark": {
        result = await callDilovod(apiKey, "setDelMark", {
          header: { id: params.id },
        });
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[dilovod-proxy] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
