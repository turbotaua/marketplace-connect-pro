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

// Product-type prefixes to strip for better search
const ITEM_TYPE_PREFIXES = [
  "свічка", "свічки", "дифузор", "дифузори", "аромадифузор", "аромадифузори",
  "аромаспрей", "аромасаше", "набір", "крем-свічка", "крем-свічки",
  "формова свічка", "міні-свічка", "міні",
];

/**
 * Normalize a search query by stripping product-type prefixes, quotes, and extra whitespace.
 */
function normalizeSearchQuery(query: string, type: "item" | "counterparty"): string {
  let q = query
    .replace(/['"«»„""''`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (type === "item") {
    const lower = q.toLowerCase();
    for (const prefix of ITEM_TYPE_PREFIXES) {
      if (lower.startsWith(prefix + " ")) {
        q = q.slice(prefix.length).trim();
        break; // only strip one prefix
      }
    }
  }

  return q;
}

/**
 * Extract distinctive words (3+ chars) from a query for fallback search.
 */
function getDistinctiveWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .filter((w) => !ITEM_TYPE_PREFIXES.includes(w));
}

async function callProxy(action: string, params: Record<string, unknown>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout
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
      console.error(`Proxy timeout (20s) for ${action}`);
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
  // Normalize both sides — strip type prefixes from candidate too
  let q = normalizeForCompare(query);
  let c = normalizeForCompare(candidateName);

  // Strip type prefixes from both for fair comparison
  for (const prefix of ITEM_TYPE_PREFIXES) {
    if (q.startsWith(prefix + " ")) { q = q.slice(prefix.length + 1); break; }
  }
  for (const prefix of ITEM_TYPE_PREFIXES) {
    if (c.startsWith(prefix + " ")) { c = c.slice(prefix.length + 1); break; }
  }

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
 * Search for a single name in the Dilovod catalog (raw API call)
 */
async function searchCatalogRaw(
  type: "item" | "counterparty",
  query: string
): Promise<ResolvedCandidate[]> {
  const action = type === "item" ? "searchItem" : "searchCounterparty";
  const data = await callProxy(action, { query, limit: 10 });
  if (!data) return [];

  const rows: any[] = Array.isArray(data) ? data : data?.result || [];

  return rows.map((r: any) => ({
    id: r.id || r.item_id || r.person_id,
    name: r.name || r.item_name || r.person_name,
    code: r.code || r.item_code || r.person_code,
  }));
}

/**
 * Multi-strategy smart search:
 * 1. Normalized full name
 * 2. Fallback: individual distinctive words (if 0 results)
 * Deduplicates and scores all results.
 */
async function smartSearch(
  type: "item" | "counterparty",
  originalQuery: string
): Promise<ResolvedCandidate[]> {
  const normalized = normalizeSearchQuery(originalQuery, type);
  console.log(`[smartSearch] type=${type}, original="${originalQuery}", normalized="${normalized}"`);

  // Strategy 1: search normalized full name
  let candidates = await searchCatalogRaw(type, normalized);

  // Strategy 2: fallback with distinctive words
  if (candidates.length === 0 && type === "item") {
    const words = getDistinctiveWords(normalized);
    for (const word of words) {
      console.log(`[smartSearch] fallback search with word: "${word}"`);
      candidates = await searchCatalogRaw(type, word);
      if (candidates.length > 0) break;
    }
  }

  // Deduplicate by id
  const seen = new Set<string>();
  const unique: ResolvedCandidate[] = [];
  for (const c of candidates) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      unique.push({
        ...c,
        score: calculateMatchScore(originalQuery, c.name || ""),
      });
    }
  }

  return unique.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

const AUTO_RESOLVE_THRESHOLD = 0.85;
const SINGLE_CANDIDATE_THRESHOLD = 0.7;

/**
 * Resolve all extracted names in a draft against Dilovod catalog.
 * Auto-resolves high-confidence matches, returns disambiguations for the rest.
 */
export async function resolveDraft(draft: DraftData): Promise<ResolveResult> {
  const disambiguations: Disambiguation[] = [];
  const resolvedDraft = JSON.parse(JSON.stringify(draft)) as DraftData;

  // Resolve counterparty
  if (!resolvedDraft.counterparty.dilovod_id) {
    const sorted = await smartSearch("counterparty", resolvedDraft.counterparty.extracted_name);

    if (sorted.length === 1 && (sorted[0].score ?? 0) >= SINGLE_CANDIDATE_THRESHOLD) {
      resolvedDraft.counterparty.dilovod_id = sorted[0].id;
      resolvedDraft.counterparty.dilovod_name = sorted[0].name;
      resolvedDraft.counterparty.flagged = false;
    } else if (sorted.length > 0 && (sorted[0].score ?? 0) >= AUTO_RESOLVE_THRESHOLD) {
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
    if (item.dilovod_id) return;

    const sorted = await smartSearch("item", item.extracted_name);

    if (sorted.length === 1 && (sorted[0].score ?? 0) >= SINGLE_CANDIDATE_THRESHOLD) {
      item.dilovod_id = sorted[0].id;
      item.dilovod_name = sorted[0].name;
      item.flagged = false;
    } else if (sorted.length > 0 && (sorted[0].score ?? 0) >= AUTO_RESOLVE_THRESHOLD) {
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
