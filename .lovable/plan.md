

# Fix: MAUDAU Feed XML Parsing Error (and verify Rozetka)

## Problem

The MAUDAU feed is broken because Shopify `body_html` (containing raw HTML like `<p>`, `<meta>`, `<style>` tags) is inserted directly into XML without protection, causing XML parsing errors. The browser shows a blank page.

The Rozetka feed was tested and returns valid XML with 197 offers -- it already uses CDATA for descriptions. If you're seeing issues with Rozetka too, it might be a different problem (please share a screenshot).

## Fix

### MAUDAU: Wrap descriptions in CDATA

**File:** `supabase/functions/generate-feed-maudau/index.ts`

Change lines 112-114 from:
```typescript
// MAUDAU: NO CDATA for descriptions, HTML allowed directly
offerXml += `      <description_ua>${descUa}</description_ua>\n`;
offerXml += `      <description_ru>${descRu}</description_ru>\n`;
```

To:
```typescript
offerXml += `      <description_ua><![CDATA[${descUa}]]></description_ua>\n`;
offerXml += `      <description_ru><![CDATA[${descRu}]]></description_ru>\n`;
```

This is exactly 2 lines of change, then redeploy the function.

## Technical Note

CDATA (`<![CDATA[...]]>`) tells the XML parser to treat the content as plain text. This prevents HTML tags like `<p>`, `<meta charset="UTF-8">`, `<style>` from being interpreted as XML elements, which was causing the parsing failure.

Rozetka and Epicentr feeds already use CDATA for their descriptions and are working correctly.
