const DEFAULT_TOPIC = "all"

const TOPIC_ALIAS_MAP: Record<string, string> = {
  market: "markets",
  markets: "markets",
  stock: "markets",
  stocks: "markets",
  equity: "markets",
  equities: "markets",
  economy: "markets",
  earnings: "markets",
  fed: "markets",
  crypto: "crypto",
  bitcoin: "crypto",
  ethereum: "crypto",
  defi: "crypto",
  altcoins: "crypto",
  nft: "crypto",
  nfts: "crypto",
  web3: "crypto",
}

export const CANONICAL_NEWS_TOPICS = [
  "all",
  "top",
  "world",
  "business",
  "technology",
  "science",
  "health",
  "sports",
  "entertainment",
  "politics",
  "environment",
  "food",
  "tourism",
  "markets",
  "crypto",
] as const

const CANONICAL_TOPIC_SET = new Set<string>(CANONICAL_NEWS_TOPICS)

const TAG_BLOCKLIST_SNIPPETS = [
  "only-available",
  "available-only",
  "premium",
  "subscriber",
  "subscribers",
  "professional",
  "corporate",
  "plans",
  "subscribe",
  "subscription",
  "newsletter",
  "advertisement",
  "sponsored",
  "cookie",
  "privacy-policy",
  "terms-of-service",
] as const

const TOPIC_PATTERNS: ReadonlyArray<{ topic: string; patterns: ReadonlyArray<RegExp> }> = [
  {
    topic: "sports",
    patterns: [
      /\b(?:sport|sports|game|games|season|playoff|playoffs|tournament|championship|league|match|matches)\b/g,
      /\b(?:baseball|basketball|football|soccer|hockey|tennis|golf)\b/g,
      /\b(?:mlb|nba|nfl|nhl|wnba|ncaa|fifa|ufc)\b/g,
      /\b(?:coach|coaches|player|players|team|teams|roster|draft)\b/g,
      /\b(?:score|scores|scored|goal|goals|touchdown|quarterback|pitcher|inning|homer)\b/g,
    ],
  },
  {
    topic: "markets",
    patterns: [
      /\b(?:nasdaq|nyse|dow|ticker|ipo|etf|etfs)\b/g,
      /\b(?:stock|stocks|share|shares|equity|equities|securities)\b/g,
      /\b(?:earnings|revenue|profit|profits|dividend|dividends|valuation|market cap)\b/g,
      /\b(?:analyst|analysts|investor|investors|price target|trading at|trades at)\b/g,
    ],
  },
  {
    topic: "business",
    patterns: [
      /\b(?:company|companies|business|businesses|industry|industries)\b/g,
      /\b(?:merger|mergers|acquisition|acquisitions|executive|executives)\b/g,
      /\b(?:ceo|cfo|startup|start up|retail|manufacturer|manufacturing)\b/g,
      /\b(?:layoff|layoffs|supply chain)\b/g,
    ],
  },
  {
    topic: "crypto",
    patterns: [
      /\b(?:crypto|bitcoin|ethereum|blockchain|token|tokens|wallet|wallets)\b/g,
      /\b(?:nft|nfts|web3|defi|stablecoin|stablecoins)\b/g,
    ],
  },
  {
    topic: "technology",
    patterns: [
      /\b(?:technology|tech|software|app|apps|platform|platforms|developer|developers)\b/g,
      /\b(?:ai|artificial intelligence|chip|chips|semiconductor|semiconductors|cloud)\b/g,
    ],
  },
  {
    topic: "science",
    patterns: [
      /\b(?:science|scientist|scientists|research|study|studies|physics|biology|chemistry)\b/g,
      /\b(?:nasa|astronomy|space telescope|experiment|experiments)\b/g,
    ],
  },
  {
    topic: "health",
    patterns: [
      /\b(?:health|medical|medicine|hospital|hospitals|doctor|doctors)\b/g,
      /\b(?:patient|patients|disease|diseases|vaccine|vaccines|wellness|fitness)\b/g,
    ],
  },
  {
    topic: "politics",
    patterns: [
      /\b(?:politics|political|election|elections|senate|house|congress|president)\b/g,
      /\b(?:governor|governors|campaign|campaigns|policy|policies|parliament)\b/g,
      /\b(?:white house|voters|ballot)\b/g,
    ],
  },
  {
    topic: "entertainment",
    patterns: [
      /\b(?:entertainment|movie|movies|film|films|television|tv|music|album|albums)\b/g,
      /\b(?:streaming|celebrity|celebrities|hollywood|box office)\b/g,
    ],
  },
  {
    topic: "environment",
    patterns: [
      /\b(?:environment|environmental|climate|emissions|carbon|pollution)\b/g,
      /\b(?:wildfire|wildfires|conservation|renewable|renewables)\b/g,
    ],
  },
  {
    topic: "food",
    patterns: [
      /\b(?:food|foods|restaurant|restaurants|recipe|recipes|chef|chefs)\b/g,
      /\b(?:dining|beverage|beverages)\b/g,
    ],
  },
  {
    topic: "tourism",
    patterns: [
      /\b(?:tourism|travel|traveler|travelers|airport|airports|airline|airlines)\b/g,
      /\b(?:hotel|hotels|resort|resorts|cruise|cruises|destination|destinations)\b/g,
    ],
  },
  {
    topic: "world",
    patterns: [
      /\b(?:world|global|international|foreign|embassy|embassies|diplomatic)\b/g,
      /\b(?:conflict|conflicts|war|wars|ministry|ministries)\b/g,
    ],
  },
] as const

const TOPIC_FAMILY_MAP: Record<string, ReadonlyArray<string>> = {
  business: ["business", "markets"],
  markets: ["markets", "business", "crypto"],
  crypto: ["crypto", "markets", "business"],
}

function normalizeTopicInput(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function normalizeClassifierText(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern)
  return matches ? matches.length : 0
}

function flattenTopicValues(values: ReadonlyArray<unknown>): string[] {
  const tokens: string[] = []
  for (const value of values) {
    if (Array.isArray(value)) {
      tokens.push(...flattenTopicValues(value))
      continue
    }
    const raw = String(value || "").trim()
    if (!raw) continue
    tokens.push(
      ...raw
        .split(/[|,/]/)
        .map((token) => token.trim())
        .filter(Boolean),
    )
  }
  return tokens
}

export function normalizeNewsTopicToken(value: unknown): string {
  const normalized = normalizeTopicInput(value)
  if (!normalized) return DEFAULT_TOPIC
  return TOPIC_ALIAS_MAP[normalized] || normalized
}

export function shouldIgnoreNewsTag(value: string): boolean {
  const normalized = normalizeNewsTopicToken(value)
  if (!normalized || normalized === DEFAULT_TOPIC) return true
  if (normalized.length < 2 || normalized.length > 24) return true
  const words = normalized.split("-").filter(Boolean)
  if (words.length === 0 || words.length > 3) return true
  if (words.every((word) => /^\d+$/.test(word))) return true
  if (normalized.includes("http") || normalized.includes("www-")) return true
  for (const blocked of TAG_BLOCKLIST_SNIPPETS) {
    if (normalized.includes(blocked)) return true
  }
  return false
}

export function scoreNewsTopicsFromText(input: { title?: string; summary?: string }): Record<string, number> {
  const text = normalizeClassifierText(`${input.title || ""} ${input.summary || ""}`)
  const scores: Record<string, number> = {}
  for (const topic of CANONICAL_NEWS_TOPICS) {
    if (topic !== DEFAULT_TOPIC) scores[topic] = 0
  }
  if (!text) return scores
  for (const { topic, patterns } of TOPIC_PATTERNS) {
    let score = 0
    for (const pattern of patterns) {
      score += countMatches(text, pattern)
    }
    scores[topic] = score
  }
  return scores
}

function getTopScoringTopics(scores: Record<string, number>): Array<{ topic: string; score: number }> {
  return Object.entries(scores)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]) && entry[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([topic, score]) => ({ topic, score }))
}

function uniqueTopics(values: ReadonlyArray<string>): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizeNewsTopicToken(value)
    if (!normalized || normalized === DEFAULT_TOPIC || seen.has(normalized)) continue
    if (!CANONICAL_TOPIC_SET.has(normalized) || shouldIgnoreNewsTag(normalized)) continue
    seen.add(normalized)
    deduped.push(normalized)
  }
  return deduped
}

export function collectCanonicalNewsTopicCandidates(values: ReadonlyArray<unknown>): string[] {
  return uniqueTopics(flattenTopicValues(values))
}

export function resolveNewsArticleClassification(input: {
  title?: string
  summary?: string
  rawTopic?: unknown
  rawTags?: ReadonlyArray<unknown>
  fallbackTopic?: unknown
}): {
  topic: string
  tags: string[]
  scores: Record<string, number>
  dominantTopic: string | null
  dominantScore: number
} {
  const fallbackTopic = normalizeNewsTopicToken(input.fallbackTopic)
  const rawCandidates = collectCanonicalNewsTopicCandidates([input.rawTopic, ...(input.rawTags || [])])
  const scores = scoreNewsTopicsFromText({ title: input.title, summary: input.summary })
  const scoredTopics = getTopScoringTopics(scores)
  const dominant = scoredTopics[0] ?? null
  const strongContentTopic = dominant && dominant.score >= 2 ? dominant.topic : null

  let topic = strongContentTopic || rawCandidates[0] || fallbackTopic
  if (!topic || topic === DEFAULT_TOPIC) {
    topic = dominant?.topic || "top"
  }

  const contentTopics = strongContentTopic
    ? scoredTopics.map((entry) => entry.topic)
    : rawCandidates.filter((candidate) => (scores[candidate] || 0) > 0)

  const tags = uniqueTopics(
    strongContentTopic
      ? [topic, ...contentTopics]
      : [topic, ...rawCandidates, ...contentTopics],
  )

  return {
    topic,
    tags: tags.length > 0 ? tags : topic !== DEFAULT_TOPIC ? [topic] : [],
    scores,
    dominantTopic: dominant?.topic || null,
    dominantScore: dominant?.score || 0,
  }
}

export function matchesRequestedNewsTopics(
  requestedTopics: ReadonlyArray<unknown>,
  classification: {
    topic: string
    tags: string[]
    scores: Record<string, number>
    dominantTopic: string | null
    dominantScore: number
  },
): boolean {
  const requested = uniqueTopics(requestedTopics.map((topic) => normalizeNewsTopicToken(topic)))
  if (requested.length === 0 || requested.includes(DEFAULT_TOPIC)) return true

  for (const topic of requested) {
    const allowedTopics = new Set<string>([topic, ...(TOPIC_FAMILY_MAP[topic] || [])])
    if (allowedTopics.has(classification.topic)) return true
    if (classification.tags.some((tag) => allowedTopics.has(tag))) return true
    for (const allowedTopic of allowedTopics) {
      if ((classification.scores[allowedTopic] || 0) > 0) return true
    }
  }

  if (
    classification.dominantTopic &&
    classification.dominantScore >= 2 &&
    !requested.some((topic) => {
      const allowedTopics = new Set<string>([topic, ...(TOPIC_FAMILY_MAP[topic] || [])])
      return allowedTopics.has(classification.dominantTopic as string)
    })
  ) {
    return false
  }

  return false
}

