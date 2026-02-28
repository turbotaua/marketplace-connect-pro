import { supabase } from "@/integrations/supabase/client";

export interface ResolvedCandidate {
  id: string;
  name: string;
  code?: string;
  score?: number;
}

export interface Disambiguation {
  field: "counterparty" | "item";
  index?: number; // for items
  extractedName: string;
  candidates: ResolvedCandidate[];
}

export interface DraftData {
  type: "draft";
  actionType: string;
  counterparty: {
    extracted_name: string;
    dilovod_id?: string | null;
    dilovod_name?: string;
    flagged?: boolean;
  };
  date: string;
  items: {
    extracted_name: string;
    dilovod_id?: string | null;
    dilovod_name?: string;
    qty: number;
    price: number;
    total: number;
    account?: string;
    flagged?: boolean;
  }[];
  total_sum: number;
  flags?: string[];
  chain?: string[];
}

export interface ResolveResult {
  draft: DraftData;
  disambiguations: Disambiguation[];
  isFullyResolved: boolean;
}

/**
 * Parse draft JSON blocks from AI response text.
 * Looks for ```json blocks with "type": "draft"
 */
export function parseDraftFromText(text: string): DraftData | null {
  // Try fenced code blocks first
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.type === "draft" && parsed.actionType && parsed.items) {
        return parsed as DraftData;
      }
    } catch {
      // not valid JSON, skip
    }
  }

  // Try standalone JSON object (AI might not wrap in code block)
  const jsonObjRegex = /\{[\s\S]*?"type"\s*:\s*"draft"[\s\S]*?\}(?=\s*$|\s*\n)/gm;
  while ((match = jsonObjRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed.type === "draft" && parsed.actionType && parsed.items) {
        return parsed as DraftData;
      }
    } catch {
      // skip
    }
  }

  return null;
}

const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dilovod-proxy`;

async function callProxy(action: string, params: Record<string, unknown>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, params }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`Proxy error ${res.status} for ${action}`);
      return null;
    }
    return res.json();
  } catch (e: any) {
    if (e.name === "AbortError") {
      console.error(`Proxy timeout (10s) for ${action}`);
    } else {
      console.error(`Proxy fetch error for ${action}:`, e);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/['"«»„"]/g, "").trim();
}

function calculateMatchScore(query: string, candidateName: string): number {
  const q = normalizeForCompare(query);
  const c = normalizeForCompare(candidateName);

  if (c === q) return 1.0;
  if (c.includes(q)) return 0.9;
  if (q.includes(c)) return 0.85;

  // Word overlap
  const qWords = q.split(/\s+/).filter(Boolean);
  const cWords = c.split(/\s+/).filter(Boolean);
  const matchedWords = qWords.filter((w) =>
    cWords.some((cw) => cw.includes(w) || w.includes(cw))
  );
  return matchedWords.length / Math.max(qWords.length, 1);
}

/**
 * Search for a single name in the Dilovod catalog
 */
async function searchCatalog(
  type: "item" | "counterparty",
  query: string
): Promise<ResolvedCandidate[]> {
  const action = type === "item" ? "searchItem" : "searchCounterparty";
  const data = await callProxy(action, { query, limit: 10 });
  if (!data) return [];

  // The proxy returns Dilovod "request" result — typically { result: [...] } or just [...]
  const rows: any[] = Array.isArray(data) ? data : data?.result || [];

  return rows.map((r: any) => ({
    id: r.id || r.item_id || r.person_id,
    name: r.name || r.item_name || r.person_name,
    code: r.code || r.item_code || r.person_code,
    score: calculateMatchScore(query, r.name || r.item_name || r.person_name || ""),
  }));
}

const AUTO_RESOLVE_THRESHOLD = 0.85;

/**
 * Resolve all extracted names in a draft against Dilovod catalog.
 * Auto-resolves high-confidence matches, returns disambiguations for the rest.
 */
export async function resolveDraft(draft: DraftData): Promise<ResolveResult> {
  const disambiguations: Disambiguation[] = [];
  const resolvedDraft = JSON.parse(JSON.stringify(draft)) as DraftData;

  // Resolve counterparty
  if (!resolvedDraft.counterparty.dilovod_id) {
    const candidates = await searchCatalog("counterparty", resolvedDraft.counterparty.extracted_name);
    const sorted = candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    if (sorted.length === 1 && (sorted[0].score ?? 0) >= AUTO_RESOLVE_THRESHOLD) {
      resolvedDraft.counterparty.dilovod_id = sorted[0].id;
      resolvedDraft.counterparty.dilovod_name = sorted[0].name;
      resolvedDraft.counterparty.flagged = false;
    } else if (sorted.length > 0) {
      disambiguations.push({
        field: "counterparty",
        extractedName: resolvedDraft.counterparty.extracted_name,
        candidates: sorted.slice(0, 5),
      });
      resolvedDraft.counterparty.flagged = true;
    } else {
      resolvedDraft.counterparty.flagged = true;
      disambiguations.push({
        field: "counterparty",
        extractedName: resolvedDraft.counterparty.extracted_name,
        candidates: [],
      });
    }
  }

  // Resolve items in parallel
  const itemPromises = resolvedDraft.items.map(async (item, index) => {
    if (item.dilovod_id) return; // already resolved

    const candidates = await searchCatalog("item", item.extracted_name);
    const sorted = candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    if (sorted.length === 1 && (sorted[0].score ?? 0) >= AUTO_RESOLVE_THRESHOLD) {
      item.dilovod_id = sorted[0].id;
      item.dilovod_name = sorted[0].name;
      item.flagged = false;
    } else if (sorted.length > 0) {
      disambiguations.push({
        field: "item",
        index,
        extractedName: item.extracted_name,
        candidates: sorted.slice(0, 5),
      });
      item.flagged = true;
    } else {
      item.flagged = true;
      disambiguations.push({
        field: "item",
        index,
        extractedName: item.extracted_name,
        candidates: [],
      });
    }
  });

  await Promise.all(itemPromises);

  return {
    draft: resolvedDraft,
    disambiguations,
    isFullyResolved: disambiguations.length === 0,
  };
}
