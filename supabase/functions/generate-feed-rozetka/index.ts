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

function parseTagValue(tags: string, prefix: string): string | null {
  if (!tags) return null;
  const tagList = tags.split(",").map((t: string) => t.trim());
  for (const tag of tagList) {
    if (tag.toLowerCase().startsWith(prefix.toLowerCase())) {
      return tag.substring(prefix.length).trim();
    }
  }
  return null;
}

function sanitizeDescription(html: string): string {
  if (!html) return "";
  // Remove forbidden tags entirely (with content for script/style/iframe)
  let clean = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  clean = clean.replace(/<style[\s\S]*?<\/style>/gi, "");
  clean = clean.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  // Remove self-closing/void forbidden tags
  clean = clean.replace(/<img[^>]*\/?>/gi, "");
  clean = clean.replace(/<video[^>]*>[\s\S]*?<\/video>/gi, "");
  clean = clean.replace(/<video[^>]*\/?>/gi, "");
  // Remove <a> tags but keep inner text
  clean = clean.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, "$1");
  // Remove style and color attributes from remaining tags
  clean = clean.replace(/\s+(style|color|bgcolor|background)\s*=\s*"[^"]*"/gi, "");
  clean = clean.replace(/\s+(style|color|bgcolor|background)\s*=\s*'[^']*'/gi, "");
  return clean.trim();
}

function stripHtmlLength(html: string): number {
  return (html || "").replace(/<[^>]*>/g, "").trim().length;
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
    const { data: mpConfig } = await sb.from("marketplace_config").select("*").eq("slug", slug).single();
    if (!mpConfig) throw new Error("Marketplace config not found");

    const { data: catMappings } = await sb.from("category_mapping").select("*").eq("marketplace_id", mpConfig.id);
    const { data: priceMultipliers } = await sb.from("price_multipliers").select("*").eq("marketplace_id", mpConfig.id);

    const nowIso = new Date().toISOString();
    const { data: promos } = await sb.from("promotions").select("*, promotion_items(*)").eq("marketplace_id", mpConfig.id).eq("is_active", true).lte("starts_at", nowIso).gte("ends_at", nowIso);

    const products = await fetchAllShopifyProducts(shopifyDomain, shopifyToken);

    const validationErrors: any[] = [];
    const offers: string[] = [];
    const categoriesMap = new Map<string, { name: string; rz_id?: string }>();

    for (const product of products) {
      if (product.status !== "active") {
        validationErrors.push({ product_title: product.title, product_sku: null, error_type: "draft", error_message: "Товар у статусі draft", marketplace_slug: slug });
        continue;
      }
      if (!product.images || product.images.length === 0) {
        validationErrors.push({ product_title: product.title, product_sku: null, error_type: "no_image", error_message: "Немає фото", marketplace_slug: slug });
        continue;
      }

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
      if (catMapping.is_active === false) continue;

      if (!categoriesMap.has(catMapping.marketplace_category_id)) {
        categoriesMap.set(catMapping.marketplace_category_id, {
          name: catMapping.marketplace_category_name || catMapping.shopify_collection_title || "",
          rz_id: catMapping.rz_id || undefined,
        });
      }

      const catMultiplier = priceMultipliers?.find((pm: any) => pm.shopify_collection_id === catMapping.shopify_collection_id);
      const multiplier = catMultiplier ? catMultiplier.multiplier : mpConfig.global_multiplier;

      // Parse tags for additional data
      const tags = product.tags || "";
      const warranty = parseTagValue(tags, "warranty:") || "14 днів";
      const country = parseTagValue(tags, "country:");
      const state = parseTagValue(tags, "state:") || "new";

      // Rozetka-specific characteristics from tags
      const tagParams: { name: string; prefix: string }[] = [
        { name: "Вид", prefix: "вид:" },
        { name: "Тип", prefix: "тип:" },
        { name: "Аромат", prefix: "аромат:" },
        { name: "Матеріал свічки", prefix: "матеріал:" },
        { name: "Час горіння", prefix: "час_горіння:" },
        { name: "Висота", prefix: "висота:" },
        { name: "Колір", prefix: "колір:" },
        { name: "Свічник", prefix: "свічник:" },
      ];

      // Sanitize description
      const sanitizedDesc = sanitizeDescription(product.body_html || "");

      // Validation: description length
      if (stripHtmlLength(product.body_html || "") < 50) {
        validationErrors.push({ product_title: product.title, product_sku: null, error_type: "no_description", error_message: "Опис відсутній або коротший за 50 символів", marketplace_slug: slug });
      }

      for (const variant of product.variants || []) {
        const price = parseFloat(variant.price);
        if (!price || price === 0) {
          validationErrors.push({ product_title: product.title, product_sku: variant.sku, error_type: "zero_price", error_message: "Ціна 0", marketplace_slug: slug });
          continue;
        }

        // Validation: barcode
        if (!variant.barcode) {
          validationErrors.push({ product_title: product.title, product_sku: variant.sku, error_type: "no_barcode", error_message: "Відсутній штрихкод", marketplace_slug: slug });
        }

        let finalPrice = applyRounding(price * multiplier, mpConfig.rounding_rule);
        const compareAtPrice = variant.compare_at_price ? applyRounding(parseFloat(variant.compare_at_price) * multiplier, mpConfig.rounding_rule) : null;

        let priceOld: number | null = compareAtPrice && compareAtPrice > finalPrice ? compareAtPrice : null;
        const promoMatch = promos?.flatMap((p: any) => (p.promotion_items || []).map((pi: any) => ({ ...pi, discount_percent: p.discount_percent }))).find((pi: any) => pi.shopify_product_id === String(product.id) && (!pi.shopify_variant_id || pi.shopify_variant_id === String(variant.id)));
        if (promoMatch) {
          priceOld = finalPrice;
          finalPrice = applyRounding(finalPrice * (1 - promoMatch.discount_percent / 100), mpConfig.rounding_rule);
        }

        const available = (variant.inventory_quantity ?? 0) > 0;
        const offerId = `${product.id}-${variant.id}`;
        const pictures = product.images.slice(0, 15).map((img: any) => `      <picture>${escapeXml(img.src)}</picture>`).join("\n");
        const variantTitle = variant.title !== "Default Title" ? ` ${variant.title}` : "";
        const productType = product.product_type || "";
        const vendorName = product.vendor || "";
        const displayType = productType.toLowerCase() === "свічки" ? "Ароматична свічка" : productType;
        const name = `${displayType} ${vendorName} ${product.title}${variantTitle}`.replace(/\s+/g, ' ').trim();

        // Validation: title length
        if (name.length > 255) {
          validationErrors.push({ product_title: product.title, product_sku: variant.sku, error_type: "title_too_long", error_message: `Назва перевищує 255 символів (${name.length})`, marketplace_slug: slug });
        }

        let offerXml = `    <offer id="${escapeXml(offerId)}" available="${available}">\n`;
        offerXml += `      <url>https://${escapeXml(shopifyDomain)}/products/${escapeXml(product.handle)}</url>\n`;
        offerXml += `      <price>${finalPrice}</price>\n`;
        if (priceOld && priceOld > finalPrice) {
          offerXml += `      <price_old>${priceOld}</price_old>\n`;
        }
        offerXml += `      <currencyId>UAH</currencyId>\n`;
        offerXml += `      <categoryId>${escapeXml(catMapping.marketplace_category_id)}</categoryId>\n`;
        offerXml += `${pictures}\n`;
        offerXml += `      <vendor>${escapeXml(product.vendor || "")}</vendor>\n`;
        if (variant.sku) offerXml += `      <article>${escapeXml(variant.sku)}</article>\n`;
        offerXml += `      <stock_quantity>${Math.max(0, variant.inventory_quantity ?? 0)}</stock_quantity>\n`;
        offerXml += `      <state>${escapeXml(state)}</state>\n`;
        offerXml += `      <name><![CDATA[${name}]]></name>\n`;
        offerXml += `      <name_ua><![CDATA[${name}]]></name_ua>\n`;
        offerXml += `      <description><![CDATA[${sanitizedDesc}]]></description>\n`;
        offerXml += `      <description_ua><![CDATA[${sanitizedDesc}]]></description_ua>\n`;

        // Product options as params
        if (product.options) {
          for (let i = 0; i < product.options.length; i++) {
            const optName = product.options[i]?.name;
            let optValue: string | undefined;
            if (variant.title !== "Default Title") {
              const optValues = variant.title?.split(" / ");
              optValue = optValues?.[i];
            } else {
              optValue = product.options[i]?.values?.[0];
            }
            if (optName && optValue) {
              offerXml += `      <param name="${escapeXml(optName)}">${escapeXml(optValue)}</param>\n`;
            }
          }
        }

        // Rozetka-required params
        offerXml += `      <param name="Гарантія">${escapeXml(warranty)}</param>\n`;
        if (country) {
          offerXml += `      <param name="Країна-виробник товару">${escapeXml(country)}</param>\n`;
        }
        if (variant.barcode) {
          offerXml += `      <param name="Штрих код">${escapeXml(variant.barcode)}</param>\n`;
        }

        // Tag-based characteristics
        for (const tp of tagParams) {
          const val = parseTagValue(tags, tp.prefix);
          if (val) {
            offerXml += `      <param name="${escapeXml(tp.name)}">${escapeXml(val)}</param>\n`;
          }
        }

        offerXml += `    </offer>`;
        offers.push(offerXml);
      }
    }

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
