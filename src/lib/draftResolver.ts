import { supabase } from "@/integrations/supabase/client";

export interface ResolvedCandidate {
  id: string;
  name: string;
  code?: string;
  score?: number;
}

export interface Disambiguation {
  field: "counterparty" | "item";
  index?: number;
  extractedName: string;
  candidates: ResolvedCandidate[];
  timedOut?: boolean;
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

export function parseDraftFromText(text: string): DraftData | null {
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.type === "draft" && parsed.actionType && parsed.items) {
        return parsed as DraftData;
      }
    } catch { /* skip */ }
  }

  const jsonObjRegex = /\{[\s\S]*?"type"\s*:\s*"draft"[\s\S]*?\}(?=\s*$|\s*\n)/gm;
  while ((match = jsonObjRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed.type === "draft" && parsed.actionType && parsed.items) {
        return parsed as DraftData;
      }
    } catch { /* skip */ }
  }

  return null;
}

const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dilovod-proxy`;

const ITEM_TYPE_PREFIXES = [
  "свічка", "свічки", "дифузор", "дифузори", "аромадифузор", "аромадифузори",
  "аромаспрей", "аромасаше", "набір", "крем-свічка", "крем-свічки",
  "формова свічка", "міні-свічка", "міні",
];

const COUNTERPARTY_SUFFIXES = [
  "фізособа", "фіз.особа", "фізична особа", "юр.особа", "юридична особа",
  "фоп", "тов", "ппг", "пп",
];

function normalizeSearchQuery(query: string, type: "item" | "counterparty"): string {
  let q = query
    .replace(/['"«»„""''`]/g, "")
    .replace(/[,;\.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (type === "item") {
    const lower = q.toLowerCase();
    for (const prefix of ITEM_TYPE_PREFIXES) {
      if (lower.startsWith(prefix + " ")) {
        q = q.slice(prefix.length).trim();
        break;
      }
    }
  }

  if (type === "counterparty") {
    const lower = q.toLowerCase();
    for (const suffix of COUNTERPARTY_SUFFIXES) {
      if (lower.endsWith(" " + suffix) || lower.endsWith(", " + suffix)) {
        q = q.replace(new RegExp("[,\\s]*" + suffix + "$", "i"), "").trim();
        break;
      }
    }
  }

  return q;
}

function getDistinctiveWords(query: string): string[] {
  const stopWords = [...ITEM_TYPE_PREFIXES, ...COUNTERPARTY_SUFFIXES, "для", "від", "або", "та"];
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .filter((w) => !stopWords.includes(w));
}

// Search actions that hit the slow single-threaded Dilovod API
const SLOW_ACTIONS = new Set(["searchCounterparty", "searchItem"]);

/**
 * Single fetch to proxy with retry.
 * Timeout: 60s for search actions, 15s for others.
 * Retries up to `maxRetries` times on AbortError / network errors.
 */
async function callProxy(
  action: string,
  params: Record<string, unknown>,
  maxRetries = 2
): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const timeoutMs = SLOW_ACTIONS.has(action) ? 60_000 : 15_000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
        console.error(`Proxy error ${res.status} for ${action} (attempt ${attempt})`);
        if (attempt < maxRetries) continue;
        return null;
      }
      return res.json();
    } catch (e: any) {
      const isRetryable = e.name === "AbortError" || e.message?.includes("fetch");
      console.error(`Proxy ${isRetryable ? "timeout/network" : "error"} for ${action} (attempt ${attempt}/${maxRetries}):`, e.message);
      if (!isRetryable || attempt >= maxRetries) return null;
      // small delay before retry
      await new Promise((r) => setTimeout(r, 1000));
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/['"«»„""''`,.\-;:]/g, "").replace(/\s+/g, " ").trim();
}

function calculateMatchScore(query: string, candidateName: string): number {
  let q = normalizeForCompare(query);
  let c = normalizeForCompare(candidateName);

  for (const prefix of ITEM_TYPE_PREFIXES) {
    if (q.startsWith(prefix + " ")) { q = q.slice(prefix.length + 1); break; }
  }
  for (const prefix of ITEM_TYPE_PREFIXES) {
    if (c.startsWith(prefix + " ")) { c = c.slice(prefix.length + 1); break; }
  }

  if (c === q) return 1.0;
  if (c.includes(q)) return 0.9;
  if (q.includes(c)) return 0.85;

  const qWords = q.split(/\s+/).filter(Boolean);
  const cWords = c.split(/\s+/).filter(Boolean);
  if (qWords.length > 0 && cWords.length > 0) {
    const matchedWords = qWords.filter((w) =>
      cWords.some((cw) => cw.includes(w) || w.includes(cw))
    );
    const overlapScore = matchedWords.length / Math.max(qWords.length, cWords.length);
    if (matchedWords.length === qWords.length) {
      return Math.max(0.8, overlapScore);
    }
    return overlapScore;
  }

  return 0;
}

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
 * Multi-strategy smart search.
 * For counterparties: SEQUENTIAL strategies to avoid overloading single-threaded API.
 * For items: full name, then single-word fallback.
 */
async function smartSearch(
  type: "item" | "counterparty",
  originalQuery: string
): Promise<ResolvedCandidate[]> {
  const normalized = normalizeSearchQuery(originalQuery, type);
  const words = getDistinctiveWords(normalized);
  console.log(`[smartSearch] type=${type}, original="${originalQuery}", normalized="${normalized}", words=${JSON.stringify(words)}`);

  let allCandidates: ResolvedCandidate[] = [];

  if (type === "counterparty" && words.length >= 2) {
    // Strategy 1: full name search (SEQUENTIAL, not parallel)
    allCandidates = await searchCatalogRaw(type, normalized);
    console.log(`[smartSearch] full name search returned ${allCandidates.length} candidates`);

    // Strategy 2: per-word searches only if full name returned nothing
    if (allCandidates.length === 0) {
      for (const w of words) {
        const results = await searchCatalogRaw(type, w);
        allCandidates.push(...results);
        console.log(`[smartSearch] word "${w}" returned ${results.length} candidates`);
      }
    }
  } else {
    // Items or single-word counterparty
    allCandidates = await searchCatalogRaw(type, normalized);
    if (allCandidates.length === 0 && words.length > 0) {
      console.log(`[smartSearch] fallback search with word: "${words[0]}"`);
      allCandidates = await searchCatalogRaw(type, words[0]);
    }
  }

  // Deduplicate by id and score
  const seen = new Set<string>();
  const unique: ResolvedCandidate[] = [];
  for (const c of allCandidates) {
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
 * Resolve a single field. Never throws.
 * Returns timedOut=true when search returned 0 results (likely timeout).
 */
async function resolveField(
  type: "counterparty" | "item",
  extractedName: string,
  index?: number
): Promise<{
  dilovod_id?: string;
  dilovod_name?: string;
  flagged: boolean;
  disambiguation?: Disambiguation;
}> {
  try {
    const searchType = type === "counterparty" ? "counterparty" : "item";
    const sorted = await smartSearch(searchType, extractedName);

    const queryWords = normalizeForCompare(extractedName).split(/\s+/).filter(Boolean);
    const isPartialQuery = queryWords.length <= 1;
    const bestScore = sorted[0]?.score ?? 0;

    // No results at all — likely timeout
    if (sorted.length === 0) {
      console.log(`[resolveField] No results for "${extractedName}" — marking as timed out`);
      return {
        flagged: true,
        disambiguation: { field: type, index, extractedName, candidates: [], timedOut: true },
      };
    }

    // For short/partial queries with multiple candidates — ALWAYS disambiguate
    if (isPartialQuery && sorted.length > 1) {
      console.log(`[resolveField] Partial query "${extractedName}" has ${sorted.length} candidates — showing disambiguation`);
      return {
        flagged: true,
        disambiguation: { field: type, index, extractedName, candidates: sorted.slice(0, 5) },
      };
    }

    // Single candidate with decent score — auto-resolve
    if (sorted.length === 1 && bestScore >= SINGLE_CANDIDATE_THRESHOLD) {
      return { dilovod_id: sorted[0].id, dilovod_name: sorted[0].name, flagged: false };
    }

    // Multiple candidates, multi-word query, high confidence — auto-resolve
    if (sorted.length > 0 && !isPartialQuery && bestScore >= AUTO_RESOLVE_THRESHOLD) {
      return { dilovod_id: sorted[0].id, dilovod_name: sorted[0].name, flagged: false };
    }

    // Needs disambiguation
    return {
      flagged: true,
      disambiguation: { field: type, index, extractedName, candidates: sorted.slice(0, 5) },
    };
  } catch (err) {
    console.error(`[resolveField] ${type} "${extractedName}" failed:`, err);
    return {
      flagged: true,
      disambiguation: { field: type, index, extractedName, candidates: [], timedOut: true },
    };
  }
}

/**
 * Resolve all extracted names in a draft against Dilovod catalog.
 * Runs SEQUENTIALLY: counterparty first, then items one by one.
 * This avoids overloading the single-threaded Dilovod API.
 */
export async function resolveDraft(draft: DraftData): Promise<ResolveResult> {
  const disambiguations: Disambiguation[] = [];
  const resolvedDraft = JSON.parse(JSON.stringify(draft)) as DraftData;

  // 1. Resolve counterparty FIRST (sequential)
  if (!resolvedDraft.counterparty.dilovod_id) {
    const result = await resolveField("counterparty", resolvedDraft.counterparty.extracted_name);
    if (result.dilovod_id) {
      resolvedDraft.counterparty.dilovod_id = result.dilovod_id;
      resolvedDraft.counterparty.dilovod_name = result.dilovod_name;
      resolvedDraft.counterparty.flagged = false;
    } else {
      resolvedDraft.counterparty.flagged = true;
    }
    if (result.disambiguation) {
      disambiguations.push(result.disambiguation);
    }
  }

  // 2. Then resolve items SEQUENTIALLY
  for (let i = 0; i < resolvedDraft.items.length; i++) {
    const item = resolvedDraft.items[i];
    if (item.dilovod_id) continue;

    const result = await resolveField("item", item.extracted_name, i);
    if (result.dilovod_id) {
      item.dilovod_id = result.dilovod_id;
      item.dilovod_name = result.dilovod_name;
      item.flagged = false;
    } else {
      item.flagged = true;
    }
    if (result.disambiguation) {
      disambiguations.push(result.disambiguation);
    }
  }

  return {
    draft: resolvedDraft,
    disambiguations,
    isFullyResolved: disambiguations.length === 0,
  };
}

/**
 * Retry resolving a single counterparty field.
 * Used by Dilovod.tsx when the first search timed out.
 */
export async function retryResolveCounterparty(extractedName: string): Promise<{
  dilovod_id?: string;
  dilovod_name?: string;
  flagged: boolean;
  disambiguation?: Disambiguation;
}> {
  return resolveField("counterparty", extractedName);
}
