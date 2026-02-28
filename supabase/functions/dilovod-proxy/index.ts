import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DILOVOD_URL = "https://api.dilovod.ua";
const DILOVOD_VERSION = "0.25";

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
        result = await callDilovod(apiKey, "listMetadata", {});
        break;
      }
      case "getMetadata": {
        result = await callDilovod(apiKey, "getMetadata", { objectType: params.objectType });
        break;
      }

      // Search counterparties
      case "searchCounterparty": {
        const query = params.query || "";
        const where: Record<string, unknown>[] = [];
        if (query) {
          where.push({ field: "name", op: "LIKE", value: `%${query}%` });
        }
        result = await callDilovod(apiKey, "request", {
          from: "catalogs.partners",
          fields: { id: "id", name: "name", code: "code" },
          where,
          limit: params.limit || 20,
          offset: params.offset || 0,
        });
        break;
      }

      // Search items
      case "searchItem": {
        const query = params.query || "";
        const where: Record<string, unknown>[] = [];
        if (query) {
          where.push({ field: "name", op: "LIKE", value: `%${query}%` });
        }
        result = await callDilovod(apiKey, "request", {
          from: "catalogs.products",
          fields: { id: "id", name: "name", code: "code" },
          where,
          limit: params.limit || 20,
          offset: params.offset || 0,
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
            fields: { id: "id", code: "code", name: "name" },
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
            fields: { id: "id", name: "name" },
            limit: 50,
          });
          await setCache(supabase, "firms", result);
        }
        break;
      }

      // Create sales order
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

      // Create/save any document
      case "createDocument": {
        result = await callDilovod(apiKey, "saveObject", {
          header: {
            id: params.objectType,
            ...params.header,
          },
          saveType: params.saveType || "new",
        });
        break;
      }

      // Create document chain
      case "createChain": {
        const { actionType, draft } = params;
        const chainIds: Record<string, string> = {};

        if (actionType === "sales.commission") {
          // 1. Sales Order
          const order = await callDilovod(apiKey, "call", {
            method: "saleOrderCreate",
            arguments: {
              header: { firm: draft.firmId, person: draft.counterpartyId, date: draft.date },
              goods: draft.items.map((i: any) => ({ good: i.dilovod_id, qty: i.qty, price: i.price })),
              placement: { autoPlacement: true },
            },
          });
          chainIds.order_id = order.result?.id || order.id;

          // 2. Customer Invoice
          const invoice = await callDilovod(apiKey, "saveObject", {
            header: {
              id: "documents.customerInvoices",
              firm: draft.firmId,
              person: draft.counterpartyId,
              date: draft.date,
              basisDocument: chainIds.order_id,
              tpGoods: draft.items.map((i: any) => ({ good: i.dilovod_id, qty: i.qty, price: i.price })),
            },
            saveType: "new",
          });
          chainIds.invoice_id = invoice.result?.id || invoice.id;

          // 3. Shipment (Transfer to Consignee)
          const transfer = await callDilovod(apiKey, "saveObject", {
            header: {
              id: "documents.shipments",
              firm: draft.firmId,
              person: draft.counterpartyId,
              date: draft.date,
              basisDocument: chainIds.order_id,
              operationType: "transferToConsignee",
              tpGoods: draft.items.map((i: any) => ({ good: i.dilovod_id, qty: i.qty, price: i.price })),
            },
            saveType: "new",
          });
          chainIds.transfer_id = transfer.result?.id || transfer.id;

        } else if (actionType === "sales.end_consumer") {
          const order = await callDilovod(apiKey, "call", {
            method: "saleOrderCreate",
            arguments: {
              header: { firm: draft.firmId, person: draft.counterpartyId, date: draft.date },
              goods: draft.items.map((i: any) => ({ good: i.dilovod_id, qty: i.qty, price: i.price })),
              placement: { autoPlacement: true },
            },
          });
          chainIds.order_id = order.result?.id || order.id;

          const shipment = await callDilovod(apiKey, "saveObject", {
            header: {
              id: "documents.shipments",
              firm: draft.firmId,
              person: draft.counterpartyId,
              date: draft.date,
              basisDocument: chainIds.order_id,
              tpGoods: draft.items.map((i: any) => ({ good: i.dilovod_id, qty: i.qty, price: i.price })),
            },
            saveType: "new",
          });
          chainIds.shipment_id = shipment.result?.id || shipment.id;

        } else if (actionType === "sales.return") {
          const ret = await callDilovod(apiKey, "saveObject", {
            header: {
              id: "documents.returnFromBuyer",
              firm: draft.firmId,
              person: draft.counterpartyId,
              date: draft.date,
              basisDocument: draft.originalShipmentId,
              tpGoods: draft.items.map((i: any) => ({ good: i.dilovod_id, qty: i.return_qty, price: i.price })),
            },
            saveType: "new",
          });
          chainIds.return_id = ret.result?.id || ret.id;

        } else if (actionType === "purchase.goods" || actionType === "purchase.services") {
          const receipt = await callDilovod(apiKey, "saveObject", {
            header: {
              id: "documents.goodsReceipt",
              firm: draft.firmId,
              person: draft.counterpartyId,
              date: draft.date,
              tpGoods: draft.items.map((i: any) => ({
                good: i.dilovod_id,
                qty: i.qty,
                price: i.price,
                account: i.accountId,
              })),
            },
            saveType: "new",
          });
          chainIds.receipt_id = receipt.result?.id || receipt.id;
        }

        result = { chainIds };
        break;
      }

      // Soft delete
      case "setDelMark": {
        result = await callDilovod(apiKey, "setDelMark", { id: params.id, del: params.del ?? true });
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
