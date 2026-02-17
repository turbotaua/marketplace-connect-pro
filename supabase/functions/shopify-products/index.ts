import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN");

    if (!shopifyToken || !shopifyDomain) {
      return new Response(
        JSON.stringify({ error: "Shopify credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "250");
    const sinceId = url.searchParams.get("since_id") || "";
    const collectionId = url.searchParams.get("collection_id") || "";

    // Fetch all products with pagination
    let allProducts: any[] = [];
    let nextPageUrl: string | null = buildInitialUrl(shopifyDomain, limit, sinceId, collectionId);

    while (nextPageUrl) {
      const response = await fetch(nextPageUrl, {
        headers: {
          "X-Shopify-Access-Token": shopifyToken,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(
          JSON.stringify({ error: `Shopify API error: ${response.status}`, details: errorText }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();
      allProducts = allProducts.concat(data.products || []);

      // Parse Link header for pagination
      nextPageUrl = getNextPageUrl(response.headers.get("Link"));
    }

    return new Response(
      JSON.stringify({
        products: allProducts,
        total: allProducts.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildInitialUrl(domain: string, limit: number, sinceId: string, collectionId: string): string {
  const base = `https://${domain}/admin/api/2024-01/products.json`;
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(limit, 250)));
  params.set("fields", "id,title,body_html,vendor,product_type,handle,status,variants,images,tags,options,metafields");
  if (sinceId) params.set("since_id", sinceId);
  if (collectionId) params.set("collection_id", collectionId);
  return `${base}?${params.toString()}`;
}

function getNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return matches ? matches[1] : null;
}
