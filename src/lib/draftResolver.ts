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

// Counterparty suffixes to strip
const COUNTERPARTY_SUFFIXES = [
  "фізособа", "фіз.особа", "фізична особа", "юр.особа", "юридична особа",
  "фоп", "тов", "ппг", "пп",
];

/**
 * Normalize a search query by stripping product-type prefixes, quotes, and extra whitespace.
 */
function normalizeSearchQuery(query: string, type: "item" | "counterparty"): string {
  let q = query
    .replace(/['"«»„""''`]/g, "")
    .replace(/[,;\.]+$/, "") // trailing punctuation
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

/**
 * Extract distinctive words (3+ chars) from a query for fallback search.
 */
function getDistinctiveWords(query: string): string[] {
  const stopWords = [...ITEM_TYPE_PREFIXES, ...COUNTERPARTY_SUFFIXES, "для", "від", "або", "та"];
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .filter((w) => !stopWords.includes(w));
}

/**
 * Single fetch to proxy. Timeout 12s. No retry.
 * Returns parsed JSON or null on error/timeout.
 */
async function callProxy(action: string, params: Record<string, unknown>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
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
      console.error(`Proxy timeout (12s) for ${action}`);
    } else {
      console.error(`Proxy fetch error for ${action}:`, e);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
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

  // Word-overlap scoring (ignores punctuation differences)
  const qWords = q.split(/\s+/).filter(Boolean);
  const cWords = c.split(/\s+/).filter(Boolean);
  if (qWords.length > 0 && cWords.length > 0) {
    const matchedWords = qWords.filter((w) =>
      cWords.some((cw) => cw.includes(w) || w.includes(cw))
    );
    const overlapScore = matchedWords.length / Math.max(qWords.length, cWords.length);
    // Boost if all query words matched
    if (matchedWords.length === qWords.length) {
      return Math.max(0.8, overlapScore);
    }
    return overlapScore;
  }

  return 0;
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
 * For counterparties: parallel full-name + per-word searches, then fallback.
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
    // Strategy 1+2 in parallel: full name + each word separately
    const searches = [
      searchCatalogRaw(type, normalized),
      ...words.map((w) => searchCatalogRaw(type, w)),
    ];
    const results = await Promise.all(searches);
    allCandidates = results.flat();
    console.log(`[smartSearch] parallel strategies returned ${allCandidates.length} total candidates`);

    // Strategy 3: fallback to first word only if parallel returned nothing
    if (allCandidates.length === 0 && words.length > 0) {
      console.log(`[smartSearch] fallback to first word: "${words[0]}"`);
      allCandidates = await searchCatalogRaw(type, words[0]);
    }
  } else {
    // Items or single-word counterparty: original behavior
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
 * Helper: resolve a single field (counterparty or item) and return disambiguation if needed.
 * Never throws — catches errors internally and flags the field.
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

    // Needs disambiguation or no results
    return {
      flagged: true,
      disambiguation: { field: type, index, extractedName, candidates: sorted.slice(0, 5) },
    };
  } catch (err) {
    console.error(`[resolveField] ${type} "${extractedName}" failed:`, err);
    return {
      flagged: true,
      disambiguation: {
        field: type,
        index,
        extractedName,
        candidates: [],
      },
    };
  }
}

/**
 * Resolve all extracted names in a draft against Dilovod catalog.
 * Runs counterparty + all items in PARALLEL (Promise.allSettled).
 * NEVER throws — always returns partial results with disambiguations.
 */
export async function resolveDraft(draft: DraftData): Promise<ResolveResult> {
  const disambiguations: Disambiguation[] = [];
  const resolvedDraft = JSON.parse(JSON.stringify(draft)) as DraftData;

  // Build all search tasks
  const tasks: Array<{ type: "counterparty" | "item"; index?: number }> = [];

  if (!resolvedDraft.counterparty.dilovod_id) {
    tasks.push({ type: "counterparty" });
  }
  resolvedDraft.items.forEach((item, i) => {
    if (!item.dilovod_id) {
      tasks.push({ type: "item", index: i });
    }
  });

  // Fire all in parallel (max concurrency is naturally limited by browser)
  const results = await Promise.allSettled(
    tasks.map((task) => {
      const name = task.type === "counterparty"
        ? resolvedDraft.counterparty.extracted_name
        : resolvedDraft.items[task.index!].extracted_name;
      return resolveField(task.type, name, task.index);
    })
  );

  // Apply results
  results.forEach((result, i) => {
    const task = tasks[i];
    // resolveField never throws, but Promise.allSettled handles it anyway
    const resolved = result.status === "fulfilled"
      ? result.value
      : { flagged: true, disambiguation: { field: task.type, index: task.index, extractedName: "", candidates: [] } as Disambiguation };

    if (task.type === "counterparty") {
      if (resolved.dilovod_id) {
        resolvedDraft.counterparty.dilovod_id = resolved.dilovod_id;
        resolvedDraft.counterparty.dilovod_name = resolved.dilovod_name;
        resolvedDraft.counterparty.flagged = false;
      } else {
        resolvedDraft.counterparty.flagged = true;
      }
    } else {
      const idx = task.index!;
      if (resolved.dilovod_id) {
        resolvedDraft.items[idx].dilovod_id = resolved.dilovod_id;
        resolvedDraft.items[idx].dilovod_name = resolved.dilovod_name;
        resolvedDraft.items[idx].flagged = false;
      } else {
        resolvedDraft.items[idx].flagged = true;
      }
    }

    if (resolved.disambiguation) {
      disambiguations.push(resolved.disambiguation);
    }
  });

  return {
    draft: resolvedDraft,
    disambiguations,
    isFullyResolved: disambiguations.length === 0,
  };
}
