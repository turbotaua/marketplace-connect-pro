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
    candidates?: ResolvedCandidate[];
    flagged?: boolean;
  };
  date: string;
  items: {
    extracted_name: string;
    dilovod_id?: string | null;
    dilovod_name?: string;
    candidates?: ResolvedCandidate[];
    qty: number;
    price: number;
    total: number;
    account?: string;
    flagged?: boolean;
  }[];
  total_sum: number;
  flags?: string[];
  chain?: string[];
  createSupplierOrder?: boolean;
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

/**
 * Convert inline candidates from AI-generated draft into Disambiguation objects.
 * This handles the new agentic format where the AI includes candidates[] directly.
 */
export function extractDisambiguationsFromDraft(draft: DraftData): Disambiguation[] {
  const disambiguations: Disambiguation[] = [];

  // Counterparty: has candidates but no dilovod_id
  if (!draft.counterparty.dilovod_id && draft.counterparty.candidates && draft.counterparty.candidates.length > 0) {
    disambiguations.push({
      field: "counterparty",
      extractedName: draft.counterparty.extracted_name,
      candidates: draft.counterparty.candidates,
    });
    draft.counterparty.flagged = true;
  } else if (!draft.counterparty.dilovod_id && Array.isArray(draft.counterparty.candidates)) {
    // AI searched but found nothing (candidates is explicitly [])
    // Don't mark as timedOut — AI already tried
    draft.counterparty.flagged = true;
    disambiguations.push({
      field: "counterparty",
      extractedName: draft.counterparty.extracted_name,
      candidates: [],
      timedOut: false,
    });
  } else if (!draft.counterparty.dilovod_id) {
    // No ID and candidates field missing entirely — AI didn't search, needs client fallback
    draft.counterparty.flagged = true;
    disambiguations.push({
      field: "counterparty",
      extractedName: draft.counterparty.extracted_name,
      candidates: [],
      timedOut: true,
    });
  } else {
    draft.counterparty.flagged = false;
  }

  // Items
  for (let i = 0; i < draft.items.length; i++) {
    const item = draft.items[i];
    if (!item.dilovod_id && item.candidates && item.candidates.length > 0) {
      disambiguations.push({
        field: "item",
        index: i,
        extractedName: item.extracted_name,
        candidates: item.candidates,
      });
      item.flagged = true;
    } else if (!item.dilovod_id && Array.isArray(item.candidates)) {
      // AI searched but found nothing
      item.flagged = true;
      disambiguations.push({
        field: "item",
        index: i,
        extractedName: item.extracted_name,
        candidates: [],
        timedOut: false,
      });
    } else if (!item.dilovod_id) {
      // AI didn't search — needs client fallback
      item.flagged = true;
      disambiguations.push({
        field: "item",
        index: i,
        extractedName: item.extracted_name,
        candidates: [],
        timedOut: true,
      });
    } else {
      item.flagged = false;
    }
  }

  return disambiguations;
}

// ─── Legacy client-side resolution (safety net) ──────────────────────────────

const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dilovod-proxy`;

const SLOW_ACTIONS = new Set(["searchCounterparty", "searchItem"]);

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

const ITEM_TYPE_PREFIXES = [
  "свічка", "свічки", "дифузор", "дифузори", "аромадифузор", "аромадифузори",
  "аромаспрей", "аромасаше", "набір", "крем-свічка", "крем-свічки",
  "формова свічка", "міні-свічка", "міні",
];

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

const AUTO_RESOLVE_THRESHOLD = 0.85;
const SINGLE_CANDIDATE_THRESHOLD = 0.7;

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
    const sorted = await searchCatalogRaw(searchType, extractedName);

    const scored = sorted.map((c) => ({
      ...c,
      score: calculateMatchScore(extractedName, c.name || ""),
    })).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const queryWords = normalizeForCompare(extractedName).split(/\s+/).filter(Boolean);
    const isPartialQuery = queryWords.length <= 1;
    const bestScore = scored[0]?.score ?? 0;

    if (scored.length === 0) {
      return {
        flagged: true,
        disambiguation: { field: type, index, extractedName, candidates: [], timedOut: true },
      };
    }

    if (isPartialQuery && scored.length > 1) {
      return {
        flagged: true,
        disambiguation: { field: type, index, extractedName, candidates: scored.slice(0, 5) },
      };
    }

    if (scored.length === 1 && bestScore >= SINGLE_CANDIDATE_THRESHOLD) {
      return { dilovod_id: scored[0].id, dilovod_name: scored[0].name, flagged: false };
    }

    if (scored.length > 0 && !isPartialQuery && bestScore >= AUTO_RESOLVE_THRESHOLD) {
      return { dilovod_id: scored[0].id, dilovod_name: scored[0].name, flagged: false };
    }

    return {
      flagged: true,
      disambiguation: { field: type, index, extractedName, candidates: scored.slice(0, 5) },
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
 * Resolve draft — SAFETY NET only.
 * Skips any field where dilovod_id is already set (AI pre-resolved it).
 * Only runs client-side search for genuinely unresolved fields without candidates.
 */
export async function resolveDraft(draft: DraftData): Promise<ResolveResult> {
  const disambiguations: Disambiguation[] = [];
  const resolvedDraft = JSON.parse(JSON.stringify(draft)) as DraftData;

  // Check if counterparty needs client-side resolution
  if (!resolvedDraft.counterparty.dilovod_id) {
    // If AI already provided candidates, just convert to disambiguation (no search needed)
    if (resolvedDraft.counterparty.candidates && resolvedDraft.counterparty.candidates.length > 0) {
      disambiguations.push({
        field: "counterparty",
        extractedName: resolvedDraft.counterparty.extracted_name,
        candidates: resolvedDraft.counterparty.candidates,
      });
      resolvedDraft.counterparty.flagged = true;
    } else {
      // No candidates from AI — do client-side search as fallback
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
  } else {
    resolvedDraft.counterparty.flagged = false;
  }

  // Resolve items
  for (let i = 0; i < resolvedDraft.items.length; i++) {
    const item = resolvedDraft.items[i];
    if (item.dilovod_id) {
      item.flagged = false;
      continue;
    }

    // If AI provided candidates, use those
    if (item.candidates && item.candidates.length > 0) {
      disambiguations.push({
        field: "item",
        index: i,
        extractedName: item.extracted_name,
        candidates: item.candidates,
      });
      item.flagged = true;
    } else {
      // Client-side fallback search
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
  }

  return {
    draft: resolvedDraft,
    disambiguations,
    isFullyResolved: disambiguations.length === 0,
  };
}

/**
 * Retry resolving a single counterparty field.
 */
export async function retryResolveCounterparty(extractedName: string): Promise<{
  dilovod_id?: string;
  dilovod_name?: string;
  flagged: boolean;
  disambiguation?: Disambiguation;
}> {
  return resolveField("counterparty", extractedName);
}
