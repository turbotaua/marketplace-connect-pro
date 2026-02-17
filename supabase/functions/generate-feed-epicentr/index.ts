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
  const slug = "epicentr";

  try {
    const { data: mpConfig } = await sb.from("marketplace_config").select("*").eq("slug", slug).single();
    if (!mpConfig) throw new Error("Marketplace config not found");

    const { data: catMappings } = await sb.from("category_mapping").select("*").eq("marketplace_id", mpConfig.id);
    const { data: priceMultipliers } = await sb.from("price_multipliers").select("*").eq("marketplace_id", mpConfig.id);

    const products = await fetchAllShopifyProducts(shopifyDomain, shopifyToken);

    const validationErrors: any[] = [];
    const offers: string[] = [];

    for (const product of products) {
      if (product.status !== "active") {
        validationErrors.push({ product_title: product.title, product_sku: null, error_type: "draft", error_message: "Товар у статусі draft", marketplace_slug: slug });
        continue;
      }
      if (!product.images || product.images.length === 0) {
        validationErrors.push({ product_title: product.title, product_sku: null, error_type: "no_image", error_message: "Немає фото", marketplace_slug: slug });
        continue;
      }

      const catMapping = catMappings?.find((cm: any) => cm.shopify_collection_title === product.product_type || cm.shopify_collection_id === product.product_type);
      if (!catMapping) {
        validationErrors.push({ product_title: product.title, product_sku: null, error_type: "no_category", error_message: "Немає mapping категорії", marketplace_slug: slug });
        continue;
      }

      const catMultiplier = priceMultipliers?.find((pm: any) => pm.shopify_collection_id === catMapping.shopify_collection_id);
      const multiplier = catMultiplier ? catMultiplier.multiplier : mpConfig.global_multiplier;
      const categoryCode = catMapping.epicentr_category_code || catMapping.marketplace_category_id;
      const categoryName = catMapping.marketplace_category_name || catMapping.shopify_collection_title || "";

      for (const variant of product.variants || []) {
        const price = parseFloat(variant.price);
        if (!price || price === 0) {
          validationErrors.push({ product_title: product.title, product_sku: variant.sku, error_type: "zero_price", error_message: "Ціна 0", marketplace_slug: slug });
          continue;
        }

        const finalPrice = applyRounding(price * multiplier, mpConfig.rounding_rule);
        const compareAtPrice = variant.compare_at_price ? applyRounding(parseFloat(variant.compare_at_price) * multiplier, mpConfig.rounding_rule) : null;
        const available = (variant.inventory_quantity ?? 0) > 0;
        const offerId = variant.sku || `${product.id}-${variant.id}`;
        const pictures = product.images.map((img: any) => `      <picture>${escapeXml(img.src)}</picture>`).join("\n");
        const variantTitle = variant.title !== "Default Title" ? ` ${variant.title}` : "";
        const nameUa = `${product.title}${variantTitle}`;
        const nameRu = nameUa;
        const descUa = product.body_html || "";
        const descRu = descUa;

        let offerXml = `    <offer id="${escapeXml(offerId)}" available="${available}">\n`;
        offerXml += `      <price>${finalPrice}</price>\n`;
        if (compareAtPrice && compareAtPrice > finalPrice) {
          offerXml += `      <price_old>${compareAtPrice}</price_old>\n`;
        }
        offerXml += `      <availability>${available ? "in_stock" : "out_of_stock"}</availability>\n`;
        offerXml += `      <category code="${escapeXml(categoryCode)}">${escapeXml(categoryName)}</category>\n`;
        offerXml += `${pictures}\n`;
        offerXml += `      <name lang="ua">${escapeXml(nameUa)}</name>\n`;
        offerXml += `      <name lang="ru">${escapeXml(nameRu)}</name>\n`;
        offerXml += `      <description lang="ua"><![CDATA[${descUa}]]></description>\n`;
        offerXml += `      <description lang="ru"><![CDATA[${descRu}]]></description>\n`;
        offerXml += `      <attribute_set code="${escapeXml(categoryCode)}">${escapeXml(categoryName)}</attribute_set>\n`;

        // Params from options with paramcode
        if (variant.title !== "Default Title" && product.options) {
          for (let i = 0; i < product.options.length; i++) {
            const optName = product.options[i]?.name;
            const optValues = variant.title?.split(" / ");
            if (optName && optValues?.[i]) {
              offerXml += `      <param name="${escapeXml(optName)}">${escapeXml(optValues[i])}</param>\n`;
            }
          }
        }

        // Barcode
        if (variant.barcode) {
          offerXml += `      <param paramcode="barcodes" name="Штрих код"><![CDATA[${variant.barcode}]]></param>\n`;
        }

        // Measure
        offerXml += `      <param paramcode="measure" name="Міра виміру" valuecode="measure_pcs">шт.</param>\n`;
        offerXml += `      <param paramcode="ratio" name="Мінімальна кратність товару"><![CDATA[1]]></param>\n`;

        // Vendor as brand
        if (product.vendor) {
          offerXml += `      <param paramcode="brand" name="Бренд">${escapeXml(product.vendor)}</param>\n`;
        }

        offerXml += `    </offer>`;
        offers.push(offerXml);
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="${formatDate(new Date())}">
  <offers>
${offers.join("\n")}
  </offers>
</yml_catalog>`;

    const duration = Date.now() - startTime;

    const { data: logEntry } = await sb.from("feed_logs").insert({
      marketplace_slug: slug,
      status: "success",
      product_count: offers.length,
      duration_ms: duration,
    }).select().single();

    if (validationErrors.length > 0 && logEntry) {
      await sb.from("validation_errors").insert(
        validationErrors.map((e) => ({ ...e, feed_log_id: logEntry.id }))
      );
    }

    const feedUrl = `${supabaseUrl}/functions/v1/generate-feed-epicentr`;
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
