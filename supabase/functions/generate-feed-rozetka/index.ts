import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function applyRounding(price: number, rule: string): number {
  switch (rule) {
    case "dot99": return Math.floor(price) + 0.99;
    case "round5": return Math.round(price / 5) * 5;
    case "round10": return Math.round(price / 10) * 10;
    default: return Math.round(price * 100) / 100;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);
  const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN")!;
  const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN")!;
  const slug = "rozetka";

  try {
    // Fetch marketplace config
    const { data: mpConfig } = await sb.from("marketplace_config").select("*").eq("slug", slug).single();
    if (!mpConfig) throw new Error("Marketplace config not found");

    // Fetch category mappings
    const { data: catMappings } = await sb.from("category_mapping").select("*").eq("marketplace_id", mpConfig.id);

    // Fetch price multipliers
    const { data: priceMultipliers } = await sb.from("price_multipliers").select("*").eq("marketplace_id", mpConfig.id);

    // Fetch all Shopify products
    const products = await fetchAllShopifyProducts(shopifyDomain, shopifyToken);

    const validationErrors: any[] = [];
    const offers: string[] = [];
    const categoriesMap = new Map<string, { name: string; rz_id?: string }>();

    for (const product of products) {
      // Skip drafts
      if (product.status !== "active") {
        validationErrors.push({ product_title: product.title, product_sku: null, error_type: "draft", error_message: "Товар у статусі draft", marketplace_slug: slug });
        continue;
      }
      // Skip no images
      if (!product.images || product.images.length === 0) {
        validationErrors.push({ product_title: product.title, product_sku: null, error_type: "no_image", error_message: "Немає фото", marketplace_slug: slug });
        continue;
      }

      // Find category mapping by product_type or collection
      const catMapping = catMappings?.find((cm: any) => {
        if (cm.shopify_product_types?.length > 0 && product.product_type) {
          return cm.shopify_product_types.includes(product.product_type);
        }
        return cm.shopify_collection_title === product.product_type;
      });
      if (!catMapping) {
        validationErrors.push({ product_title: product.title, product_sku: null, error_type: "no_category", error_message: "Немає mapping категорії", marketplace_slug: slug });
        continue;
      }

      // Add to categories map
      if (!categoriesMap.has(catMapping.marketplace_category_id)) {
        categoriesMap.set(catMapping.marketplace_category_id, {
          name: catMapping.marketplace_category_name || catMapping.shopify_collection_title || "",
          rz_id: catMapping.rz_id || undefined,
        });
      }

      // Get multiplier (category-specific > global)
      const catMultiplier = priceMultipliers?.find((pm: any) => pm.shopify_collection_id === catMapping.shopify_collection_id);
      const multiplier = catMultiplier ? catMultiplier.multiplier : mpConfig.global_multiplier;

      // Each variant = separate offer
      for (const variant of product.variants || []) {
        const price = parseFloat(variant.price);
        if (!price || price === 0) {
          validationErrors.push({ product_title: product.title, product_sku: variant.sku, error_type: "zero_price", error_message: "Ціна 0", marketplace_slug: slug });
          continue;
        }

        const finalPrice = applyRounding(price * multiplier, mpConfig.rounding_rule);
        const compareAtPrice = variant.compare_at_price ? applyRounding(parseFloat(variant.compare_at_price) * multiplier, mpConfig.rounding_rule) : null;
        const available = (variant.inventory_quantity ?? 0) > 0;
        const offerId = `${product.id}-${variant.id}`;
        const pictures = product.images.slice(0, 15).map((img: any) => `      <picture>${escapeXml(img.src)}</picture>`).join("\n");
        const variantTitle = variant.title !== "Default Title" ? ` ${variant.title}` : "";
        const name = `${product.title}${variantTitle}`;

        let offerXml = `    <offer id="${escapeXml(offerId)}" available="${available}">\n`;
        offerXml += `      <price>${finalPrice}</price>\n`;
        if (compareAtPrice && compareAtPrice > finalPrice) {
          offerXml += `      <price_old>${compareAtPrice}</price_old>\n`;
        }
        offerXml += `      <currencyId>UAH</currencyId>\n`;
        offerXml += `      <categoryId>${escapeXml(catMapping.marketplace_category_id)}</categoryId>\n`;
        offerXml += `${pictures}\n`;
        offerXml += `      <vendor>${escapeXml(product.vendor || "")}</vendor>\n`;
        if (variant.sku) offerXml += `      <article>${escapeXml(variant.sku)}</article>\n`;
        offerXml += `      <stock_quantity>${Math.max(0, variant.inventory_quantity ?? 0)}</stock_quantity>\n`;
        offerXml += `      <name><![CDATA[${name}]]></name>\n`;
        offerXml += `      <name_ua><![CDATA[${name}]]></name_ua>\n`;
        offerXml += `      <description><![CDATA[${product.body_html || ""}]]></description>\n`;
        offerXml += `      <description_ua><![CDATA[${product.body_html || ""}]]></description_ua>\n`;

        // Params from options
        if (variant.title !== "Default Title" && product.options) {
          for (let i = 0; i < product.options.length; i++) {
            const optName = product.options[i]?.name;
            const optValues = variant.title?.split(" / ");
            if (optName && optValues?.[i]) {
              offerXml += `      <param name="${escapeXml(optName)}">${escapeXml(optValues[i])}</param>\n`;
            }
          }
        }

        offerXml += `    </offer>`;
        offers.push(offerXml);
      }
    }

    // Build categories XML
    const categoriesXml = Array.from(categoriesMap.entries())
      .map(([id, cat]) => {
        const rzAttr = cat.rz_id ? ` rz_id="${escapeXml(cat.rz_id)}"` : "";
        return `      <category id="${escapeXml(id)}"${rzAttr}>${escapeXml(cat.name)}</category>`;
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="${formatDate(new Date())}">
  <shop>
    <name>TURBOTA</name>
    <company>TURBOTA</company>
    <url>https://turbota.com.ua/</url>
    <currencies>
      <currency id="UAH" rate="1"/>
    </currencies>
    <categories>
${categoriesXml}
    </categories>
    <offers>
${offers.join("\n")}
    </offers>
  </shop>
</yml_catalog>`;

    const duration = Date.now() - startTime;

    // Log result
    const { data: logEntry } = await sb.from("feed_logs").insert({
      marketplace_slug: slug,
      status: "success",
      product_count: offers.length,
      duration_ms: duration,
    }).select().single();

    // Log validation errors
    if (validationErrors.length > 0 && logEntry) {
      await sb.from("validation_errors").insert(
        validationErrors.map((e) => ({ ...e, feed_log_id: logEntry.id }))
      );
    }

    // Update feed URL
    const feedUrl = `${supabaseUrl}/functions/v1/generate-feed-rozetka`;
    await sb.from("marketplace_config").update({ feed_url: feedUrl }).eq("id", mpConfig.id);

    return new Response(xml, {
      headers: { ...corsHeaders, "Content-Type": "application/xml; charset=utf-8" },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    await sb.from("feed_logs").insert({
      marketplace_slug: slug,
      status: "error",
      error_message: error.message,
      duration_ms: duration,
    });
    return new Response(
      JSON.stringify({ error: error.message, product_count: 0 }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function fetchAllShopifyProducts(domain: string, token: string): Promise<any[]> {
  let all: any[] = [];
  let url: string | null = `https://${domain}/admin/api/2024-01/products.json?limit=250&fields=id,title,body_html,vendor,product_type,handle,status,variants,images,tags,options`;

  while (url) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);
    const data = await res.json();
    all = all.concat(data.products || []);
    const link = res.headers.get("Link");
    const match = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = match ? match[1] : null;
  }
  return all;
}
