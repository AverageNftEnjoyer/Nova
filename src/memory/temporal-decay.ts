import type { SearchResult } from "./types.js";

export interface TemporalDecayOptions {
  enabled?: boolean;
  halfLifeDays?: number;
  minMultiplier?: number;
  query?: string;
  temporalHalfLifeDays?: number;
  evergreenHalfLifeDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TEMPORAL_QUERY_TERMS = new Set([
  "today",
  "yesterday",
  "latest",
  "recent",
  "currently",
  "current",
  "now",
  "new",
  "updated",
  "update",
  "this week",
  "this month",
  "status",
  "timeline",
]);
const EVERGREEN_MEMORY_TERMS = new Set([
  "name",
  "timezone",
  "preference",
  "preferences",
  "birthday",
  "address",
  "email",
  "phone",
  "profile",
  "bio",
  "identity",
  "favorite",
  "remember",
]);

function toLambda(halfLifeDays: number): number {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 0;
  return Math.LN2 / halfLifeDays;
}

function computeMultiplier(ageInDays: number, halfLifeDays: number): number {
  const lambda = toLambda(halfLifeDays);
  const clampedAge = Math.max(0, ageInDays);
  if (lambda <= 0) return 1;
  return Math.exp(-lambda * clampedAge);
}

function tokenize(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function detectQuerySignals(query: string): {
  temporalIntent: boolean;
  evergreenIntent: boolean;
} {
  const raw = String(query || "").toLowerCase().trim();
  if (!raw) return { temporalIntent: false, evergreenIntent: false };
  const tokens = new Set(tokenize(raw));
  const includesTerm = (term: string): boolean => {
    if (term.includes(" ")) return raw.includes(term);
    return tokens.has(term);
  };

  let temporalIntent = false;
  let evergreenIntent = false;
  for (const term of TEMPORAL_QUERY_TERMS) {
    if (includesTerm(term)) {
      temporalIntent = true;
      break;
    }
  }
  for (const term of EVERGREEN_MEMORY_TERMS) {
    if (includesTerm(term)) {
      evergreenIntent = true;
      break;
    }
  }
  return { temporalIntent, evergreenIntent };
}

function resolveHalfLifeDays(query: string, options: TemporalDecayOptions): number {
  const baseHalfLife = Number(options.halfLifeDays ?? 45);
  const temporalHalfLifeDays = Number(options.temporalHalfLifeDays ?? 21);
  const evergreenHalfLifeDays = Number(options.evergreenHalfLifeDays ?? 180);
  const { temporalIntent, evergreenIntent } = detectQuerySignals(query);

  if (temporalIntent && !evergreenIntent) {
    return Math.max(3, Math.min(baseHalfLife, temporalHalfLifeDays));
  }
  if (evergreenIntent && !temporalIntent) {
    return Math.max(baseHalfLife, evergreenHalfLifeDays);
  }
  return baseHalfLife;
}

export function applyTemporalDecayToSearchResults(
  results: SearchResult[],
  options: TemporalDecayOptions = {},
): SearchResult[] {
  const enabled = options.enabled ?? true;
  const halfLifeDays = resolveHalfLifeDays(options.query ?? "", options);
  const minMultiplier = Math.max(0.05, Math.min(1, Number(options.minMultiplier ?? 0.35)));
  if (!enabled || results.length === 0) return [...results];

  const now = Date.now();
  return results.map((result) => {
    const updatedAt = Number(result.updatedAt || 0);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return result;
    const ageInDays = Math.max(0, now - updatedAt) / DAY_MS;
    const multiplier = Math.max(minMultiplier, computeMultiplier(ageInDays, halfLifeDays));
    return {
      ...result,
      score: result.score * multiplier,
    };
  });
}
