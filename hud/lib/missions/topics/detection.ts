/**
 * Multi-Topic Detection
 *
 * Utilities for detecting and parsing multiple distinct topics from mission prompts.
 * Enables creating separate fetch steps for each topic for better search results.
 */

import { cleanText } from "../text/cleaning"

// ─────────────────────────────────────────────────────────────────────────────
// Topic Types
// ─────────────────────────────────────────────────────────────────────────────

export type TopicCategory =
  | "sports"
  | "markets"
  | "crypto"
  | "weather"
  | "news"
  | "motivation"
  | "quotes"
  | "tech"
  | "entertainment"
  | "general"

export interface DetectedTopic {
  category: TopicCategory
  label: string
  searchQuery: string
  keywords: string[]
  siteHints: string[]
  aiSectionTitle: string
}

export interface TopicDetectionResult {
  topics: DetectedTopic[]
  isSingleTopic: boolean
  aiPrompt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Topic Patterns
// ─────────────────────────────────────────────────────────────────────────────

interface TopicPattern {
  category: TopicCategory
  patterns: RegExp[]
  extractLabel: (match: string, prompt: string) => string
  buildQuery: (match: string, prompt: string) => string
  siteHints: string[]
  aiSectionTitle: string
}

function normalizeMissionIntent(prompt: string): string {
  const raw = cleanText(prompt)
  const stripped = raw
    .replace(/^\s*(hey|hi|yo)\s+nova[\s,:-]*/i, "")
    .replace(/^\s*nova[\s,:-]*/i, "")
    .replace(/\b(create|build|make|generate|setup|set up)\b\s+(?:me\s+)?(?:a\s+)?(mission|workflow|automation)\b/gi, " ")
    .replace(/\b(send|deliver|post|notify)\s+me\b/gi, " ")
    .replace(/\b(remind me to|set a reminder to)\b/gi, " ")
    .replace(/\b(every day|daily|every morning|every night|weekly)\b/gi, " ")
    .replace(/\b(at|around|by)\s+[01]?\d(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?\b/gi, " ")
    .replace(/\b(EST|EDT|ET|CST|CDT|CT|MST|MDT|MT|PST|PDT|PT|UTC|GMT)\b/gi, " ")
    .replace(/\b(to|on)\s+(telegram|discord|telegram|chat|email|webhook)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
  return stripped || raw
}

function normalizePromptForDetection(prompt: string): string {
  return normalizeMissionIntent(prompt)
    .replace(/\bmotviational\b/gi, "motivational")
    .replace(/\binspiriational\b/gi, "inspirational")
    .replace(/\btop story from the day before\b/gi, "top news story yesterday")
    .replace(/\bday before\b/gi, "yesterday")
    .replace(/\s+/g, " ")
    .trim()
}

function buildGeneralSearchQuery(prompt: string): string {
  const intent = normalizePromptForDetection(prompt)
  const n = intent.toLowerCase()
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })

  if (/\b(motivational?|inspirational?)\b/.test(n) && /\b(speech|message|talk|affirmation|encouragement)\b/.test(n)) {
    return `motivational speech of the day ${today}`
  }
  if (/\b(motivational?|inspirational?)\b/.test(n) && /\b(quote|quotes)\b/.test(n)) {
    return `"quote of the day" ${today} motivational inspirational`
  }

  const stopwords = new Set([
    "a", "an", "the", "to", "for", "and", "or", "in", "on", "at", "of", "with",
    "me", "my", "please", "today", "tomorrow", "tonight", "every", "day",
    "from", "before", "along", "story",
  ])
  const keywords = intent
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopwords.has(token))
    .slice(0, 10)
    .join(" ")
  return cleanText(keywords || intent).slice(0, 180)
}

const TOPIC_PATTERNS: TopicPattern[] = [
  // Sports - NBA
  {
    category: "sports",
    patterns: [
      /\b(nba|basketball)\b.*\b(scores?|games?|results?|recap|last night|yesterday)\b/i,
      /\b(scores?|games?|results?|recap)\b.*\b(nba|basketball)\b/i,
      /\bnba\b/i,
    ],
    extractLabel: () => "NBA Scores",
    buildQuery: (_, prompt) => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const dateStr = yesterday.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      if (/last night|yesterday/i.test(prompt)) {
        return `NBA scores ${dateStr} final results`
      }
      return `NBA scores today ${dateStr} games results`
    },
    siteHints: ["espn.com", "nba.com", "sports.yahoo.com"],
    aiSectionTitle: "NBA Scores",
  },
  // Sports - NFL
  {
    category: "sports",
    patterns: [
      /\b(nfl|football)\b.*\b(scores?|games?|results?|recap)\b/i,
      /\b(scores?|games?|results?|recap)\b.*\b(nfl|football)\b/i,
    ],
    extractLabel: () => "NFL Scores",
    buildQuery: () => {
      const today = new Date()
      const dateStr = today.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      return `NFL scores ${dateStr} game results`
    },
    siteHints: ["espn.com", "nfl.com", "sports.yahoo.com"],
    aiSectionTitle: "NFL Scores",
  },
  // Sports - MLB
  {
    category: "sports",
    patterns: [
      /\b(mlb|baseball)\b.*\b(scores?|games?|results?|recap)\b/i,
      /\b(scores?|games?|results?|recap)\b.*\b(mlb|baseball)\b/i,
    ],
    extractLabel: () => "MLB Scores",
    buildQuery: () => {
      const today = new Date()
      const dateStr = today.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      return `MLB scores ${dateStr} game results`
    },
    siteHints: ["espn.com", "mlb.com", "sports.yahoo.com"],
    aiSectionTitle: "MLB Scores",
  },
  // Sports - Generic
  {
    category: "sports",
    patterns: [
      /\b(sports?)\b.*\b(scores?|news|updates?|recap)\b/i,
      /\b(scores?|recap)\b.*\b(sports?)\b/i,
    ],
    extractLabel: () => "Sports Update",
    buildQuery: () => {
      const today = new Date()
      const dateStr = today.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      return `sports news scores ${dateStr}`
    },
    siteHints: ["espn.com", "sports.yahoo.com", "bleacherreport.com"],
    aiSectionTitle: "Sports",
  },
  // Stock Markets
  {
    category: "markets",
    patterns: [
      /\b(stock|stocks|market|markets|s&p|dow|nasdaq|trading)\b.*\b(news|updates?|report|today|recap)\b/i,
      /\b(market|financial)\s*(news|updates?|report|recap)\b/i,
      /\bmarket\s*updates?\b/i,
    ],
    extractLabel: () => "Market Update",
    buildQuery: () => {
      const today = new Date()
      const dateStr = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      return `stock market news ${dateStr} S&P 500 Dow Jones`
    },
    siteHints: ["reuters.com", "bloomberg.com", "cnbc.com", "marketwatch.com"],
    aiSectionTitle: "Market Update",
  },
  // Crypto
  {
    category: "crypto",
    patterns: [
      /\b(crypto|bitcoin|btc|ethereum|eth|cryptocurrency)\b.*\b(news|price|updates?|report)\b/i,
      /\b(crypto|bitcoin|ethereum)\b/i,
    ],
    extractLabel: () => "Crypto Update",
    buildQuery: () => {
      const today = new Date()
      const dateStr = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      return `cryptocurrency news ${dateStr} Bitcoin Ethereum prices`
    },
    siteHints: ["coindesk.com", "cointelegraph.com", "decrypt.co"],
    aiSectionTitle: "Crypto Update",
  },
  // Weather
  {
    category: "weather",
    patterns: [
      /\b(weather|forecast|temperature|rain|snow)\b/i,
    ],
    extractLabel: (_, prompt) => {
      const cityMatch = prompt.match(/weather\s+(?:in|for|at)\s+([A-Za-z\s]+?)(?:\s|,|$)/i)
      return cityMatch ? `Weather in ${cityMatch[1].trim()}` : "Weather Forecast"
    },
    buildQuery: (_, prompt) => {
      const cityMatch = prompt.match(/weather\s+(?:in|for|at)\s+([A-Za-z\s]+?)(?:\s|,|$)/i)
      const city = cityMatch ? cityMatch[1].trim() : ""
      return city ? `${city} weather forecast today` : "weather forecast today"
    },
    siteHints: ["weather.com", "accuweather.com"],
    aiSectionTitle: "Weather",
  },
  // Motivational Quotes
  {
    category: "motivation",
    patterns: [
      /\b(motivational?|motivation|motviational?|inspirational?|inspiration|hype(?:\s*up)?)\s*(speech|message|talk|affirmation|encouragement|pep talk)\b/i,
      /\b(daily|morning)\s*(motivation|affirmation|encouragement)\b/i,
      /\b(motivation|motivational?|inspirational?)\b/i,
    ],
    extractLabel: () => "Motivational Brief",
    buildQuery: (_, prompt) => {
      const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      const intent = normalizeMissionIntent(prompt)
      if (/\bspeech\b/i.test(intent)) return `motivational speech of the day ${today}`
      return `daily motivational message ${today}`
    },
    siteHints: ["inc.com", "success.com", "brainyquote.com", "passiton.com"],
    aiSectionTitle: "Motivational Brief",
  },
  // Motivational Quotes
  {
    category: "quotes",
    patterns: [
      /\b(motivational?|inspirational?|daily)\s*(quote|quotes|saying|wisdom)\b/i,
      /\b(quote|quotes)\s*(of the day|daily|morning)\b/i,
      /\bquote\b/i,
    ],
    extractLabel: () => "Daily Quote",
    buildQuery: () => {
      const today = new Date()
      const dateStr = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      // Target specific quote-of-the-day pages that feature a single quote
      return `"quote of the day" ${dateStr} motivational inspirational`
    },
    siteHints: ["brainyquote.com/quote_of_the_day", "passiton.com"],
    aiSectionTitle: "Today's Quote",
  },
  // Tech News
  {
    category: "tech",
    patterns: [
      /\b(tech|technology|ai|artificial intelligence)\b.*\b(news|updates?|breakthroughs?)\b/i,
      /\b(tech|ai)\s*news\b/i,
    ],
    extractLabel: () => "Tech News",
    buildQuery: () => {
      const today = new Date()
      const dateStr = today.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      return `technology news ${dateStr} AI announcements`
    },
    siteHints: ["techcrunch.com", "theverge.com", "arstechnica.com", "wired.com"],
    aiSectionTitle: "Tech News",
  },
  // Entertainment
  {
    category: "entertainment",
    patterns: [
      /\b(entertainment|celebrity|movie|film|tv|television|hollywood)\b.*\b(news|updates?|gossip)\b/i,
      /\b(entertainment|celebrity)\s*news\b/i,
    ],
    extractLabel: () => "Entertainment News",
    buildQuery: () => {
      const today = new Date()
      const dateStr = today.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      return `entertainment news ${dateStr} movies TV celebrities`
    },
    siteHints: ["ew.com", "variety.com", "hollywoodreporter.com"],
    aiSectionTitle: "Entertainment",
  },
  // General News
  {
    category: "news",
    patterns: [
      /\b(news|headlines?|current events?|world news|top stories)\b/i,
      /\b(top|main|biggest)\s*(story|headline)\b/i,
      /\b(yesterday|day before|last night)\b.*\b(story|headline|news)\b/i,
    ],
    extractLabel: () => "News Headlines",
    buildQuery: (_, prompt) => {
      const today = new Date()
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const dateStr = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      const yesterdayStr = yesterday.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      if (/\b(yesterday|day before|last night)\b/i.test(prompt)) {
        return `top news story ${yesterdayStr} world and US`
      }
      return `top news headlines ${dateStr} breaking news`
    },
    siteHints: ["apnews.com", "reuters.com", "bbc.com/news"],
    aiSectionTitle: "Top Headlines",
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Detection Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect all distinct topics in a mission prompt.
 */
export function detectTopicsInPrompt(prompt: string): TopicDetectionResult {
  const normalized = normalizePromptForDetection(prompt).toLowerCase()
  const detectedTopics: DetectedTopic[] = []
  const usedCategories = new Set<string>()

  // Check each pattern
  for (const pattern of TOPIC_PATTERNS) {
    // Skip if we already detected this specific category
    const categoryKey = `${pattern.category}:${pattern.aiSectionTitle}`
    if (usedCategories.has(categoryKey)) continue

    for (const regex of pattern.patterns) {
      const match = regex.exec(normalized)
      if (match) {
        usedCategories.add(categoryKey)
        detectedTopics.push({
          category: pattern.category,
          label: pattern.extractLabel(match[0], prompt),
          searchQuery: pattern.buildQuery(match[0], prompt),
          keywords: match[0].split(/\s+/).filter(Boolean),
          siteHints: pattern.siteHints,
          aiSectionTitle: pattern.aiSectionTitle,
        })
        break
      }
    }
  }

  // If no specific topics detected, treat as general query
  if (detectedTopics.length === 0) {
    detectedTopics.push({
      category: "general",
      label: "Web Search",
      searchQuery: buildGeneralSearchQuery(prompt),
      keywords: [],
      siteHints: [],
      aiSectionTitle: "Summary",
    })
  }

  return {
    topics: detectedTopics,
    isSingleTopic: detectedTopics.length === 1,
    aiPrompt: buildMultiTopicAiPrompt(detectedTopics, prompt),
  }
}

/**
 * Build an AI prompt that handles multiple topic sections.
 */
export function buildMultiTopicAiPrompt(topics: DetectedTopic[], userPrompt = ""): string {
  const normalizedIntent = normalizePromptForDetection(userPrompt).slice(0, 220)
  if (topics.length === 0) {
    return "Summarize the fetched data in clear bullet points."
  }

  if (topics.length === 1) {
    const topic = topics[0]
    return buildSingleTopicAiPrompt(topic, normalizedIntent)
  }

  const hasMotivation = topics.some((topic) => topic.category === "motivation")
  const hasNews = topics.some((topic) => topic.category === "news")
  if (hasMotivation && hasNews) {
    return [
      normalizedIntent ? `User request: ${normalizedIntent}` : "",
      "Create one combined message with two parts:",
      "1) A custom motivational speech written by Nova (4-6 short sentences, original wording, energetic but not cringe).",
      "2) The top news story from yesterday from fetched sources (headline + 2 sentence summary + one-line why it matters).",
      "If news evidence is weak, say that briefly and still provide the motivational speech.",
      "Do not include raw URLs in the body text.",
    ].filter(Boolean).join("\n")
  }

  const sectionInstructions = topics.map((topic) => `- ${topic.aiSectionTitle}: ${getTopicSummaryInstruction(topic, normalizedIntent)}`).join("\n")
  return [
    normalizedIntent ? `User request: ${normalizedIntent}` : "",
    "Use fetched data to produce a concise multi-part update.",
    "Cover each requested area:",
    sectionInstructions,
    "Output shape: short section headers with 2-3 bullets per section.",
    "Do not fabricate facts. If a section has weak data, state uncertainty briefly.",
    "Do not include raw URLs in body text.",
  ].join("\n")
}

/**
 * Build AI prompt for a single topic.
 */
function buildSingleTopicAiPrompt(topic: DetectedTopic, userIntent = ""): string {
  const instruction = getTopicSummaryInstruction(topic, userIntent)
  const requestLine = userIntent
    ? `User request: ${userIntent}`
    : `User request: deliver a concise ${topic.aiSectionTitle.toLowerCase()} update.`
  return [
    `Focus area: ${topic.aiSectionTitle}`,
    requestLine,
    instruction,
    "Output shape: 3-5 short bullets unless topic instruction says otherwise.",
    "Quality rules: do not fabricate facts, and state uncertainty briefly if evidence is thin.",
    "Do not include raw URLs in the body text.",
  ].join("\n")
}

/**
 * Get topic-specific summarization instructions.
 */
function getTopicSummaryInstruction(topic: DetectedTopic, userIntent = ""): string {
  const intentLine = userIntent ? `Address this request directly: "${userIntent}".` : "Address the user request directly."
  switch (topic.category) {
    case "sports":
      return "List final scores in format: Team A [score] - [score] Team B. Include 2-3 notable performances if mentioned. If no completed games/final scores are available, write exactly: No NBA games were played last night."
    case "markets":
      return "Report in this format:\n   - S&P 500: [value] ([+/-X.X%])\n   - Dow Jones: [value] ([+/-X.X%])\n   - Nasdaq: [value] ([+/-X.X%])\n   - Brief note on market driver if available"
    case "crypto":
      return "Report in this format:\n   - Bitcoin: $[price] ([+/-X.X%] 24h)\n   - Ethereum: $[price] ([+/-X.X%] 24h)\n   - One sentence on market sentiment if available"
    case "weather":
      return "Report: Current temp, High/Low, Conditions (sunny/cloudy/rain), and any alerts."
    case "quotes":
      return "Extract ONE clean motivational quote. Format EXACTLY as:\n   \"[Quote text]\" - [Author Name]\n   \n   Do NOT include multiple quotes. Do NOT include website text, navigation, or article descriptions. Just the single best quote with its author."
    case "motivation":
      return `${intentLine} Produce one short motivational speech (3-5 sentences) that feels natural to read aloud. Use fetched themes for grounding; avoid fabricated claims or fake citations.`
    case "tech":
      return "List 2-3 top tech headlines as bullets. Each bullet: one sentence summary of the story."
    case "entertainment":
      return "List 2-3 top entertainment headlines as bullets. Each bullet: one sentence summary."
    case "news":
      return "List 3-4 top headlines as bullets. Each bullet: headline + one sentence context."
    default:
      return `${intentLine} Summarize concrete facts as 2-4 concise bullet points and keep language practical.`
  }
}

/**
 * Check if prompt contains multiple distinct topics.
 */
export function hasMultipleTopics(prompt: string): boolean {
  const result = detectTopicsInPrompt(prompt)
  return result.topics.length > 1
}

/**
 * Extract topic labels from prompt for display.
 */
export function extractTopicLabels(prompt: string): string[] {
  const result = detectTopicsInPrompt(prompt)
  return result.topics.map((t) => t.label)
}


