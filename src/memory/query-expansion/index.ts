const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "that",
  "the",
  "this",
  "to",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

const SYNONYM_MAP: Record<string, string[]> = {
  timezone: ["tz", "time-zone", "time"],
  location: ["city", "place", "region"],
  address: ["location", "place"],
  birthday: ["birthdate", "dob"],
  schedule: ["calendar", "plan", "timeline"],
  reminder: ["remember", "note"],
  preference: ["prefer", "favorite", "settings"],
  payment: ["billing", "invoice", "subscription"],
  price: ["cost", "pricing", "rate"],
  cost: ["price", "pricing", "expense"],
  error: ["issue", "problem", "failure"],
  bug: ["issue", "problem", "error"],
};

function normalizeToken(token: string): string {
  return token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "").toLowerCase();
}

function stemToken(token: string): string {
  if (token.length <= 4) return token;
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 6) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return token;
}

function uniquePush(out: string[], seen: Set<string>, token: string): void {
  const normalized = normalizeToken(token);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  out.push(normalized);
}

export function extractMemoryQueryKeywords(query: string): string[] {
  const rawTokens = String(query || "").split(/\s+/g).map(normalizeToken).filter(Boolean);
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const token of rawTokens) {
    if (STOP_WORDS.has(token)) continue;
    if (/^\d+$/.test(token)) continue;
    if (token.length < 3) continue;
    uniquePush(deduped, seen, token);
    const stemmed = stemToken(token);
    if (stemmed.length >= 3) uniquePush(deduped, seen, stemmed);
  }

  return deduped;
}

export function expandMemoryQuery(query: string): string {
  const base = String(query || "").trim();
  if (!base) return "";
  const keywords = extractMemoryQueryKeywords(base);
  if (keywords.length === 0) return base;

  const extras: string[] = [];
  const seen = new Set<string>(extractMemoryQueryKeywords(base));
  const normalizedBase = base.toLowerCase();

  for (const keyword of keywords) {
    const synonyms = SYNONYM_MAP[keyword] ?? [];
    for (const synonym of synonyms) {
      const normalized = normalizeToken(synonym);
      if (!normalized || normalizedBase.includes(normalized)) continue;
      uniquePush(extras, seen, normalized);
      if (extras.length >= 10) break;
    }
    if (extras.length >= 10) break;
  }

  const expansionTerms = [...keywords, ...extras]
    .map((token) => normalizeToken(token))
    .filter(Boolean)
    .filter((token, index, all) => all.indexOf(token) === index)
    .slice(0, 12);

  if (expansionTerms.length === 0) return base;
  return `${base} ${expansionTerms.join(" ")}`.trim();
}
