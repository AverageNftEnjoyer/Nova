/**
 * Mission Template Library — V.26 Enterprise Overhaul
 *
 * 50+ pre-built mission templates organized by enterprise category.
 * Each template is a complete Mission blueprint ready to clone.
 */

import type { Mission, MissionNode, MissionConnection, MissionCategory, Provider } from "../types/index"
import { defaultMissionSettings } from "../types/index"
import { getRuntimeTimezone } from "@/lib/shared/timezone"

const TEMPLATE_TIMEZONE = getRuntimeTimezone()

// ─────────────────────────────────────────────────────────────────────────────
// Template Builder Helpers
// ─────────────────────────────────────────────────────────────────────────────

function n(id: string, x: number, y: number): { id: string; position: { x: number; y: number } } {
  return { id, position: { x, y } }
}

function conn(id: string, src: string, tgt: string, srcPort = "main", tgtPort = "main"): MissionConnection {
  return { id, sourceNodeId: src, sourcePort: srcPort, targetNodeId: tgt, targetPort: tgtPort }
}

type TemplateBlueprint = Omit<Mission, "id" | "userId" | "createdAt" | "updatedAt" | "runCount" | "successCount" | "failureCount">

export interface MissionTemplate {
  id: string
  label: string
  description: string
  category: MissionCategory
  tags: string[]
  icon: string
  useCase: string
  blueprint: TemplateBlueprint
}

function makeTemplate(id: string, label: string, description: string, useCase: string, category: MissionCategory, tags: string[], icon: string, nodes: MissionNode[], connections: MissionConnection[], extraTags: string[] = []): MissionTemplate {
  return {
    id,
    label,
    description,
    category,
    tags: [...tags, ...extraTags],
    icon,
    useCase,
    blueprint: {
      label,
      description,
      category,
      tags: [...tags, ...extraTags],
      status: "draft",
      version: 1,
      nodes,
      connections,
      variables: [],
      settings: defaultMissionSettings(),
      integration: "telegram",
      chatIds: [],
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH Templates
// ─────────────────────────────────────────────────────────────────────────────

const MORNING_BRIEFING: MissionTemplate = makeTemplate(
  "morning-briefing",
  "Morning Briefing",
  "Daily news digest delivered each morning with top headlines and key updates.",
  "Get a curated summary of the day's top headlines across news, tech, and business.",
  "research",
  ["news", "daily", "morning", "briefing"],
  "Newspaper",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 8:00 AM", triggerMode: "daily", triggerTime: "08:00", triggerTimezone: TEMPLATE_TIMEZONE } as MissionNode,
    { ...n("s1", 320, 200), type: "web-search", label: "Search Headlines", query: "top world news headlines today site:reuters.com OR site:apnews.com OR site:bbc.com", includeSources: false, fetchContent: true } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-summarize", label: "Summarize Briefing", prompt: "Write a concise morning briefing with 5-7 bullet points. Include one short 'Watch Today' section.", integration: "claude", detailLevel: "standard" } as MissionNode,
    { ...n("o1", 760, 200), type: "telegram-output", label: "Send to Telegram" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "s1", "a1"), conn("c3", "a1", "o1")],
)

const COMPETITOR_MONITOR: MissionTemplate = makeTemplate(
  "competitor-monitor",
  "Competitor Monitor",
  "Track competitor news, product launches, and announcements automatically.",
  "Stay ahead by monitoring competitors' press releases, product updates, and news mentions.",
  "research",
  ["competitor", "market", "intelligence", "weekly"],
  "Eye",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Weekly Monday 9:00 AM", triggerMode: "weekly", triggerTime: "09:00", triggerDays: ["mon"], triggerTimezone: TEMPLATE_TIMEZONE } as MissionNode,
    { ...n("s1", 320, 200), type: "web-search", label: "Search Competitor News", query: "{{$vars.competitor_name}} product launch announcement news this week", includeSources: true, fetchContent: true } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-summarize", label: "Analyze Competitor Activity", prompt: "Summarize key competitor moves this week. Flag any new product launches, pricing changes, or strategic shifts. Include an impact assessment.", integration: "claude", detailLevel: "standard" } as MissionNode,
    { ...n("o1", 760, 200), type: "telegram-output", label: "Send to Telegram" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "s1", "a1"), conn("c3", "a1", "o1")],
  ["competitor", "intelligence"],
)

const TECH_DIGEST: MissionTemplate = makeTemplate(
  "tech-news-digest",
  "Tech News Digest",
  "Daily digest of top technology and AI announcements.",
  "Get the most important tech and AI news every day, filtered for signal over noise.",
  "research",
  ["tech", "ai", "daily", "news"],
  "Cpu",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 12:00 PM", triggerMode: "daily", triggerTime: "12:00" } as MissionNode,
    { ...n("s1", 320, 200), type: "web-search", label: "Search Tech News", query: "technology AI product announcements today site:techcrunch.com OR site:theverge.com OR site:wired.com", fetchContent: true } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-summarize", label: "Curate Tech Digest", prompt: "Highlight 4-5 significant stories. For each, add a one-line 'Why it matters'. Skip fluff. Focus on AI, developer tools, and business tech.", integration: "claude" } as MissionNode,
    { ...n("o1", 760, 200), type: "telegram-output", label: "Send to Telegram" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "s1", "a1"), conn("c3", "a1", "o1")],
)

const INDUSTRY_REPORT: MissionTemplate = makeTemplate(
  "industry-weekly-report",
  "Weekly Industry Report",
  "Automated weekly report on trends and developments in your industry.",
  "Get a structured weekly research report on your specific industry vertical.",
  "research",
  ["research", "industry", "weekly", "report"],
  "BarChart3",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Friday at 5:00 PM", triggerMode: "weekly", triggerTime: "17:00", triggerDays: ["fri"] } as MissionNode,
    { ...n("s1", 320, 120), type: "web-search", label: "Search Industry Trends", query: "{{$vars.industry}} trends analysis market outlook this week", fetchContent: true } as MissionNode,
    { ...n("s2", 320, 280), type: "web-search", label: "Search Key Events", query: "{{$vars.industry}} major events announcements funding this week", fetchContent: true } as MissionNode,
    { ...n("m1", 540, 200), type: "merge", label: "Combine Research", mode: "wait-all", inputCount: 2 } as MissionNode,
    { ...n("a1", 760, 200), type: "ai-generate", label: "Write Weekly Report", prompt: "Write a professional weekly industry report with sections: Executive Summary, Key Trends, Notable Events, and Outlook. Use markdown formatting.", integration: "claude", detailLevel: "detailed" } as MissionNode,
    { ...n("o1", 980, 200), type: "email-output", label: "Send by Email" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "t1", "s2"), conn("c3", "s1", "m1", "main", "input_0"), conn("c4", "s2", "m1", "main", "input_1"), conn("c5", "m1", "a1"), conn("c6", "a1", "o1")],
)

// ─────────────────────────────────────────────────────────────────────────────
// FINANCE Templates
// ─────────────────────────────────────────────────────────────────────────────

const CRYPTO_PORTFOLIO: MissionTemplate = makeTemplate(
  "crypto-portfolio-daily",
  "Crypto Portfolio Daily",
  "Daily Coinbase portfolio snapshot with price movements and PnL context.",
  "Track your crypto portfolio performance with a daily automated report from Coinbase.",
  "finance",
  ["coinbase", "crypto", "portfolio", "daily"],
  "TrendingUp",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 9:00 AM", triggerMode: "daily", triggerTime: "09:00" } as MissionNode,
    { ...n("cb", 320, 200), type: "coinbase", label: "Fetch Portfolio", intent: "portfolio", assets: ["BTC", "ETH", "SOL"], quoteCurrency: "USD", format: { style: "standard" } } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-summarize", label: "Summarize Portfolio", prompt: "Summarize the Coinbase portfolio snapshot. Highlight top movers, total value change, and add a brief risk note.", integration: "claude" } as MissionNode,
    { ...n("o1", 760, 200), type: "telegram-output", label: "Send to Telegram" } as MissionNode,
  ],
  [conn("c1", "t1", "cb"), conn("c2", "cb", "a1"), conn("c3", "a1", "o1")],
)

const PRICE_ALERT: MissionTemplate = makeTemplate(
  "crypto-price-alert",
  "Crypto Price Alert",
  "Monitor crypto assets for significant price movements and alert when thresholds are breached.",
  "Get notified when Bitcoin, Ethereum, or other assets move more than a set percentage.",
  "finance",
  ["crypto", "price", "alert", "bitcoin", "ethereum"],
  "Bell",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Every 30 Minutes", triggerMode: "interval", triggerIntervalMinutes: 30 } as MissionNode,
    { ...n("cb", 320, 200), type: "coinbase", label: "Check Prices", intent: "price", assets: ["BTC", "ETH", "SOL"], quoteCurrency: "USD", thresholdPct: 3 } as MissionNode,
    { ...n("cond", 540, 200), type: "condition", label: "Threshold Breached?", rules: [{ field: "{{$nodes.Check Prices.output.text}}", operator: "contains", value: "%" }], logic: "all" } as MissionNode,
    { ...n("a1", 760, 120), type: "ai-generate", label: "Write Alert", prompt: "Write a concise price alert message. State which assets moved, by how much, and what to watch.", integration: "claude", detailLevel: "concise" } as MissionNode,
    { ...n("o1", 980, 120), type: "telegram-output", label: "Send Alert" } as MissionNode,
  ],
  [conn("c1", "t1", "cb"), conn("c2", "cb", "cond"), conn("c3", "cond", "a1", "true"), conn("c4", "a1", "o1")],
)

const WEEKLY_PNL: MissionTemplate = makeTemplate(
  "weekly-pnl-report",
  "Weekly PnL Report",
  "Automated weekly profit and loss summary from Coinbase portfolio data.",
  "Receive a structured weekly PnL report every Friday evening.",
  "finance",
  ["coinbase", "pnl", "weekly", "report"],
  "DollarSign",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Friday at 6:00 PM", triggerMode: "weekly", triggerTime: "18:00", triggerDays: ["fri"] } as MissionNode,
    { ...n("cb", 320, 200), type: "coinbase", label: "Fetch Weekly Snapshot", intent: "report", cadence: "weekly", assets: ["BTC", "ETH", "SOL"], format: { style: "detailed" } } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-generate", label: "Write PnL Summary", prompt: "Write a weekly PnL report with sections: Portfolio Overview, Top Performers, Risk Exposure, and Weekly Outlook. State clearly if PnL inputs are unavailable.", integration: "claude", detailLevel: "detailed" } as MissionNode,
    { ...n("o1", 760, 200), type: "telegram-output", label: "Send to Telegram" } as MissionNode,
  ],
  [conn("c1", "t1", "cb"), conn("c2", "cb", "a1"), conn("c3", "a1", "o1")],
)

const MARKET_SNAPSHOT: MissionTemplate = makeTemplate(
  "market-snapshot",
  "Market Snapshot",
  "Pre-market indexes and macro drivers summarized every morning.",
  "Get a quick read on equity futures, key macro signals, and overnight news before markets open.",
  "finance",
  ["market", "premarket", "macro", "daily"],
  "Activity",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 7:30 AM", triggerMode: "daily", triggerTime: "07:30" } as MissionNode,
    { ...n("s1", 320, 200), type: "web-search", label: "Fetch Market Data", query: "S&P 500 futures Nasdaq Dow premarket movers macro drivers site:reuters.com OR site:bloomberg.com", fetchContent: true } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-summarize", label: "Write Market Snapshot", prompt: "Provide a sharp market snapshot under 200 words. Sections: Index Futures, Key Drivers, Risk Watch.", integration: "claude", detailLevel: "concise" } as MissionNode,
    { ...n("o1", 760, 200), type: "telegram-output", label: "Send to Telegram" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "s1", "a1"), conn("c3", "a1", "o1")],
)

const EARNINGS_WATCH: MissionTemplate = makeTemplate(
  "earnings-watch",
  "Earnings Watch",
  "Track upcoming earnings reports for companies in your watchlist.",
  "Get notified about upcoming earnings dates and post-earnings summaries for your tracked stocks.",
  "finance",
  ["earnings", "stocks", "investor", "weekly"],
  "Calendar",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Weekly Monday 7:00 AM", triggerMode: "weekly", triggerTime: "07:00", triggerDays: ["mon"] } as MissionNode,
    { ...n("s1", 320, 200), type: "web-search", label: "Search Earnings Calendar", query: "earnings reports this week S&P 500 companies site:earningswhispers.com OR site:nasdaq.com", fetchContent: true } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-generate", label: "Earnings Briefing", prompt: "List companies reporting earnings this week with dates. For each, note analyst expectations and one key watch item. Use a table format.", integration: "claude", detailLevel: "standard" } as MissionNode,
    { ...n("o1", 760, 200), type: "email-output", label: "Send by Email" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "s1", "a1"), conn("c3", "a1", "o1")],
)

// ─────────────────────────────────────────────────────────────────────────────
// DEVOPS Templates
// ─────────────────────────────────────────────────────────────────────────────

const UPTIME_CHECK: MissionTemplate = makeTemplate(
  "uptime-monitor",
  "Uptime Monitor",
  "Periodically check if your service endpoints are responding correctly.",
  "Ping your API or website every N minutes and alert on failure.",
  "devops",
  ["uptime", "monitoring", "alerts", "api", "health"],
  "Activity",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Every 5 Minutes", triggerMode: "interval", triggerIntervalMinutes: 5 } as MissionNode,
    { ...n("h1", 320, 200), type: "http-request", label: "Health Check", method: "GET", url: "{{$vars.service_url}}/health", responseFormat: "json" } as MissionNode,
    { ...n("cond", 540, 200), type: "condition", label: "Is Down?", rules: [{ field: "{{$nodes.Health Check.output.ok}}", operator: "equals", value: "false" }], logic: "all" } as MissionNode,
    { ...n("a1", 760, 120), type: "ai-generate", label: "Write Alert", prompt: "Write a brief downtime alert. State the service URL, response received (or timeout), and recommended immediate action.", integration: "claude", detailLevel: "concise" } as MissionNode,
    { ...n("o1", 980, 120), type: "discord-output", label: "Send to Discord" } as MissionNode,
  ],
  [conn("c1", "t1", "h1"), conn("c2", "h1", "cond"), conn("c3", "cond", "a1", "true"), conn("c4", "a1", "o1")],
)

const ERROR_ALERT: MissionTemplate = makeTemplate(
  "error-log-alert",
  "Error Log Alert",
  "Monitor your application error logs and alert when critical errors spike.",
  "Poll your error tracking endpoint and alert your team when error rates exceed a threshold.",
  "devops",
  ["errors", "logs", "alert", "monitoring", "devops"],
  "AlertTriangle",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Every 15 Minutes", triggerMode: "interval", triggerIntervalMinutes: 15 } as MissionNode,
    { ...n("h1", 320, 200), type: "http-request", label: "Fetch Error Metrics", method: "GET", url: "{{$vars.metrics_endpoint}}", responseFormat: "json" } as MissionNode,
    { ...n("cond", 540, 200), type: "condition", label: "Error Spike?", rules: [{ field: "{{$nodes.Fetch Error Metrics.output.data.errorRate}}", operator: "greater_than", value: "{{$vars.error_threshold}}" }], logic: "all" } as MissionNode,
    { ...n("a1", 760, 120), type: "ai-generate", label: "Write Error Alert", prompt: "Write a critical error alert for the engineering team. State error rate, affected endpoints, and suggest triage steps.", integration: "claude", detailLevel: "concise" } as MissionNode,
    { ...n("o1", 980, 120), type: "slack-output", label: "Alert Slack Channel" } as MissionNode,
  ],
  [conn("c1", "t1", "h1"), conn("c2", "h1", "cond"), conn("c3", "cond", "a1", "true"), conn("c4", "a1", "o1")],
)

const DEPLOY_NOTIFIER: MissionTemplate = makeTemplate(
  "deploy-notifier",
  "Deploy Notifier",
  "Notify your team when a deployment is triggered via webhook.",
  "Receive a webhook from your CI/CD pipeline and broadcast deployment status to your team.",
  "devops",
  ["deploy", "cicd", "notification", "team"],
  "Rocket",
  [
    { ...n("t1", 100, 200), type: "webhook-trigger", label: "CI/CD Webhook", method: "POST", path: "/deploy", authentication: "bearer" } as MissionNode,
    { ...n("a1", 320, 200), type: "ai-generate", label: "Format Deploy Notice", prompt: "Format a deployment notification from the webhook payload. Include: service name, environment, version, deployer, and status.", integration: "claude", detailLevel: "concise" } as MissionNode,
    { ...n("sp", 540, 200), type: "split", label: "Notify Channels", outputCount: 2 } as MissionNode,
    { ...n("o1", 760, 120), type: "slack-output", label: "Notify Slack" } as MissionNode,
    { ...n("o2", 760, 280), type: "discord-output", label: "Notify Discord" } as MissionNode,
  ],
  [conn("c1", "t1", "a1"), conn("c2", "a1", "sp"), conn("c3", "sp", "o1", "output_0"), conn("c4", "sp", "o2", "output_1")],
)

const SSL_EXPIRY: MissionTemplate = makeTemplate(
  "ssl-cert-expiry",
  "SSL Certificate Expiry",
  "Check SSL certificate expiry for your domains and alert when approaching expiration.",
  "Get weekly alerts when your SSL certs are within 30 days of expiry.",
  "devops",
  ["ssl", "certificate", "security", "expiry", "devops"],
  "Shield",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Weekly Monday", triggerMode: "weekly", triggerTime: "09:00", triggerDays: ["mon"] } as MissionNode,
    { ...n("h1", 320, 200), type: "http-request", label: "Check SSL", method: "GET", url: "https://ssl-checker.io/api/v1/check/{{$vars.domain}}", responseFormat: "json" } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-generate", label: "SSL Report", prompt: "Summarize SSL certificate status for the domain. Flag if expiry is within 30 days and recommend action.", integration: "claude", detailLevel: "concise" } as MissionNode,
    { ...n("o1", 760, 200), type: "email-output", label: "Email Alert" } as MissionNode,
  ],
  [conn("c1", "t1", "h1"), conn("c2", "h1", "a1"), conn("c3", "a1", "o1")],
)

// ─────────────────────────────────────────────────────────────────────────────
// MARKETING Templates
// ─────────────────────────────────────────────────────────────────────────────

const BRAND_MENTIONS: MissionTemplate = makeTemplate(
  "brand-mentions",
  "Brand Mentions Monitor",
  "Track mentions of your brand across the web and summarize sentiment daily.",
  "Monitor what's being said about your brand online and get a daily sentiment summary.",
  "marketing",
  ["brand", "mentions", "sentiment", "pr", "daily"],
  "MessageSquare",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 8:00 AM", triggerMode: "daily", triggerTime: "08:00" } as MissionNode,
    { ...n("s1", 320, 200), type: "web-search", label: "Search Brand Mentions", query: "\"{{$vars.brand_name}}\" news review mention site:reddit.com OR site:twitter.com OR site:producthunt.com", fetchContent: true } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-classify", label: "Sentiment Analysis", prompt: "Classify the overall sentiment of these brand mentions as Positive, Neutral, or Negative. List 3 key themes.", integration: "claude", categories: ["Positive", "Neutral", "Negative"] } as MissionNode,
    { ...n("a2", 760, 200), type: "ai-generate", label: "Brand Briefing", prompt: "Write a brand mentions briefing. Include: overall sentiment, top topics, notable mentions, and recommended response if any.", integration: "claude" } as MissionNode,
    { ...n("o1", 980, 200), type: "slack-output", label: "Post to Slack" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "s1", "a1"), conn("c3", "a1", "a2"), conn("c4", "a2", "o1")],
)

const SEO_RANK_WATCH: MissionTemplate = makeTemplate(
  "seo-rank-watch",
  "SEO Rank Watch",
  "Track search rankings for your target keywords and alert on changes.",
  "Monitor your SEO position for critical keywords and get weekly ranking reports.",
  "marketing",
  ["seo", "search", "rankings", "keywords", "weekly"],
  "TrendingUp",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Weekly Monday 9:00 AM", triggerMode: "weekly", triggerTime: "09:00", triggerDays: ["mon"] } as MissionNode,
    { ...n("s1", 320, 200), type: "web-search", label: "Check Rankings", query: "site:{{$vars.domain}} {{$vars.target_keywords}} position rank", fetchContent: true } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-summarize", label: "Rank Analysis", prompt: "Analyze the search ranking data for the target keywords. Identify rank improvements, drops, and opportunities. Compare to previous week if available.", integration: "claude", detailLevel: "standard" as const } as MissionNode,
    { ...n("o1", 760, 200), type: "email-output", label: "Weekly SEO Report" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "s1", "a1"), conn("c3", "a1", "o1")],
)

const AD_SPEND_ALERT: MissionTemplate = makeTemplate(
  "ad-spend-alert",
  "Ad Spend Alert",
  "Monitor daily ad spend against budget and alert when approaching limits.",
  "Get daily alerts if your ad campaigns are overspending or underperforming.",
  "marketing",
  ["ads", "spend", "budget", "alert", "daily"],
  "CreditCard",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 6:00 PM", triggerMode: "daily", triggerTime: "18:00" } as MissionNode,
    { ...n("h1", 320, 200), type: "http-request", label: "Fetch Ad Spend", method: "GET", url: "{{$vars.ads_api_endpoint}}", responseFormat: "json" } as MissionNode,
    { ...n("cond", 540, 200), type: "condition", label: "Budget Alert?", rules: [{ field: "{{$nodes.Fetch Ad Spend.output.data.spendPct}}", operator: "greater_than", value: "80" }], logic: "all" } as MissionNode,
    { ...n("a1", 760, 120), type: "ai-generate", label: "Spend Alert", prompt: "Write a concise ad spend alert. State current spend, budget remaining, ROAS, and recommend action.", integration: "claude", detailLevel: "concise" } as MissionNode,
    { ...n("o1", 980, 120), type: "slack-output", label: "Alert Marketing Team" } as MissionNode,
  ],
  [conn("c1", "t1", "h1"), conn("c2", "h1", "cond"), conn("c3", "cond", "a1", "true"), conn("c4", "a1", "o1")],
)

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT Templates
// ─────────────────────────────────────────────────────────────────────────────

const CONTENT_IDEAS: MissionTemplate = makeTemplate(
  "weekly-content-ideas",
  "Weekly Content Ideas",
  "AI-generated content ideas based on trending topics in your niche.",
  "Get 10 fresh content ideas every Monday based on what's trending in your industry.",
  "content",
  ["content", "ideas", "weekly", "trending", "ai"],
  "Lightbulb",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Monday at 9:00 AM", triggerMode: "weekly", triggerTime: "09:00", triggerDays: ["mon"] } as MissionNode,
    { ...n("s1", 320, 200), type: "web-search", label: "Trending Topics", query: "{{$vars.niche}} trending topics content ideas this week", fetchContent: true } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-generate", label: "Generate Ideas", prompt: "Generate 10 specific, actionable content ideas for {{$vars.niche}}. For each: title, format (blog/video/thread), hook, and estimated engagement potential.", integration: "claude", detailLevel: "detailed" } as MissionNode,
    { ...n("o1", 760, 200), type: "telegram-output", label: "Content Planner" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "s1", "a1"), conn("c3", "a1", "o1")],
)

const RSS_SUMMARY: MissionTemplate = makeTemplate(
  "rss-feed-digest",
  "RSS Feed Digest",
  "Summarize items from your favorite RSS feeds into a clean daily digest.",
  "Aggregate multiple RSS feeds and get an AI-curated digest of the best content.",
  "content",
  ["rss", "feed", "digest", "daily", "content"],
  "Rss",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 7:00 AM", triggerMode: "daily", triggerTime: "07:00" } as MissionNode,
    { ...n("r1", 320, 200), type: "rss-feed", label: "Read Feed", url: "{{$vars.rss_url}}", maxItems: 20 } as MissionNode,
    { ...n("f1", 540, 200), type: "filter", label: "Filter Recent", expression: "new Date($item.pubDate) > new Date(Date.now() - 86400000)" } as MissionNode,
    { ...n("a1", 760, 200), type: "ai-summarize", label: "Curate Digest", prompt: "Curate the top 5 items from today's feed. For each: headline, 1-sentence summary, and why it's worth reading.", integration: "claude" } as MissionNode,
    { ...n("o1", 980, 200), type: "telegram-output", label: "Daily Digest" } as MissionNode,
  ],
  [conn("c1", "t1", "r1"), conn("c2", "r1", "f1"), conn("c3", "f1", "a1"), conn("c4", "a1", "o1")],
)

// ─────────────────────────────────────────────────────────────────────────────
// PERSONAL Templates
// ─────────────────────────────────────────────────────────────────────────────

const WEATHER_BRIEF: MissionTemplate = makeTemplate(
  "weather-briefing",
  "Weather Briefing",
  "Daily weather forecast with activity recommendations.",
  "Get a personalized daily weather briefing with commute and activity suggestions.",
  "personal",
  ["weather", "daily", "forecast", "personal"],
  "Cloud",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 7:00 AM", triggerMode: "daily", triggerTime: "07:00" } as MissionNode,
    { ...n("s1", 320, 200), type: "web-search", label: "Fetch Weather", query: "weather forecast today tomorrow {{$vars.city}} site:weather.com OR site:weatherunderground.com", fetchContent: true } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-generate", label: "Weather Briefing", prompt: "Write a friendly daily weather briefing for {{$vars.city}}. Include: high/low, conditions, precipitation chance, UV index, and 1 activity suggestion.", integration: "claude", detailLevel: "concise" } as MissionNode,
    { ...n("o1", 760, 200), type: "telegram-output", label: "Send to Telegram" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "s1", "a1"), conn("c3", "a1", "o1")],
)

const SPORTS_RECAP: MissionTemplate = makeTemplate(
  "sports-recap",
  "Sports Daily Recap",
  "Overnight game scores and top storylines from your favorite sports.",
  "Wake up to scores and analysis from last night's games across NBA, NFL, MLB, and more.",
  "personal",
  ["sports", "scores", "daily", "nba", "nfl", "mlb"],
  "Trophy",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 8:00 AM", triggerMode: "daily", triggerTime: "08:00" } as MissionNode,
    { ...n("s1", 320, 200), type: "web-search", label: "Fetch Scores", query: "NBA NFL MLB scores last night final results site:espn.com OR site:nba.com", fetchContent: true } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-summarize", label: "Sports Briefing", prompt: "List final scores from last night's games. Add one standout storyline and the must-watch game of tonight.", integration: "claude", detailLevel: "concise" } as MissionNode,
    { ...n("o1", 760, 200), type: "telegram-output", label: "Send to Telegram" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "s1", "a1"), conn("c3", "a1", "o1")],
)

const HABIT_TRACKER: MissionTemplate = makeTemplate(
  "evening-habit-check",
  "Evening Habit Check",
  "Daily evening prompt to log your habits and get a motivational summary.",
  "Get a personalized evening message that reflects your habit goals and encourages consistency.",
  "personal",
  ["habits", "daily", "evening", "productivity", "personal"],
  "CheckSquare",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 9:00 PM", triggerMode: "daily", triggerTime: "21:00" } as MissionNode,
    { ...n("a1", 320, 200), type: "ai-generate", label: "Habit Check Message", prompt: "Write a warm, motivating evening check-in message about habits: {{$vars.habit_list}}. Acknowledge consistency, celebrate small wins, and set tomorrow's intention. Keep it under 100 words.", integration: "claude", detailLevel: "concise" } as MissionNode,
    { ...n("o1", 540, 200), type: "telegram-output", label: "Evening Check-in" } as MissionNode,
  ],
  [conn("c1", "t1", "a1"), conn("c2", "a1", "o1")],
)

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY Templates
// ─────────────────────────────────────────────────────────────────────────────

const VULN_SCAN: MissionTemplate = makeTemplate(
  "vulnerability-digest",
  "Vulnerability Digest",
  "Weekly digest of CVEs and security vulnerabilities affecting your tech stack.",
  "Stay ahead of threats with a weekly automated vulnerability report for your dependencies.",
  "security",
  ["security", "cve", "vulnerability", "weekly", "devsecops"],
  "Shield",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Weekly Tuesday 9:00 AM", triggerMode: "weekly", triggerTime: "09:00", triggerDays: ["tue"] } as MissionNode,
    { ...n("s1", 320, 200), type: "web-search", label: "Search CVEs", query: "CVE vulnerability 2024 critical high severity {{$vars.tech_stack}} site:nvd.nist.gov OR site:github.com/advisories", fetchContent: true } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-summarize", label: "CVE Digest", prompt: "Summarize this week's critical CVEs relevant to {{$vars.tech_stack}}. For each: CVE ID, severity, affected component, and recommended mitigation.", integration: "claude", detailLevel: "detailed" } as MissionNode,
    { ...n("o1", 760, 200), type: "slack-output", label: "Post to #security" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "s1", "a1"), conn("c3", "a1", "o1")],
)

// ─────────────────────────────────────────────────────────────────────────────
// DATA ANALYTICS Templates
// ─────────────────────────────────────────────────────────────────────────────

const API_METRICS: MissionTemplate = makeTemplate(
  "api-metrics-report",
  "API Metrics Report",
  "Daily report on your API performance metrics — latency, error rates, throughput.",
  "Automated daily API health report pulled from your metrics endpoint.",
  "data_analytics",
  ["api", "metrics", "performance", "daily", "analytics"],
  "BarChart2",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 8:00 AM", triggerMode: "daily", triggerTime: "08:00" } as MissionNode,
    { ...n("h1", 320, 200), type: "http-request", label: "Fetch Metrics", method: "GET", url: "{{$vars.metrics_endpoint}}", responseFormat: "json" } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-generate", label: "Write Metrics Report", prompt: "Write a concise API metrics report. Include: p50/p99 latency, error rate, throughput vs yesterday, and any anomalies to investigate.", integration: "claude" } as MissionNode,
    { ...n("o1", 760, 200), type: "slack-output", label: "Post to #engineering" } as MissionNode,
  ],
  [conn("c1", "t1", "h1"), conn("c2", "h1", "a1"), conn("c3", "a1", "o1")],
)

const DATA_PIPELINE_ALERT: MissionTemplate = makeTemplate(
  "data-pipeline-monitor",
  "Data Pipeline Monitor",
  "Monitor data pipeline runs and alert when jobs fail or lag.",
  "Track your ETL/data pipeline job statuses and alert on failures.",
  "data_analytics",
  ["data", "pipeline", "etl", "monitoring", "alert"],
  "Workflow",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Every Hour", triggerMode: "interval", triggerIntervalMinutes: 60 } as MissionNode,
    { ...n("h1", 320, 200), type: "http-request", label: "Check Pipeline Status", method: "GET", url: "{{$vars.pipeline_status_endpoint}}", responseFormat: "json" } as MissionNode,
    { ...n("cond", 540, 200), type: "condition", label: "Failed Jobs?", rules: [{ field: "{{$nodes.Check Pipeline Status.output.data.failedJobs}}", operator: "greater_than", value: "0" }], logic: "all" } as MissionNode,
    { ...n("a1", 760, 120), type: "ai-generate", label: "Pipeline Alert", prompt: "Write a data pipeline failure alert with: affected jobs, error messages, downstream impact, and recommended recovery steps.", integration: "claude", detailLevel: "concise" } as MissionNode,
    { ...n("o1", 980, 120), type: "slack-output", label: "Alert Data Team" } as MissionNode,
  ],
  [conn("c1", "t1", "h1"), conn("c2", "h1", "cond"), conn("c3", "cond", "a1", "true"), conn("c4", "a1", "o1")],
)

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER SUCCESS Templates
// ─────────────────────────────────────────────────────────────────────────────

const CHURN_RISK: MissionTemplate = makeTemplate(
  "churn-risk-alert",
  "Churn Risk Alert",
  "Identify at-risk customers from your CRM data and alert your CS team.",
  "Automatically flag customers showing churn signals and route to your success team.",
  "customer_success",
  ["churn", "retention", "crm", "customer", "alert"],
  "UserX",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 9:00 AM", triggerMode: "daily", triggerTime: "09:00" } as MissionNode,
    { ...n("h1", 320, 200), type: "http-request", label: "Fetch At-Risk Accounts", method: "GET", url: "{{$vars.crm_endpoint}}/accounts?risk_score_gte=70", responseFormat: "json" } as MissionNode,
    { ...n("cond", 540, 200), type: "condition", label: "At-Risk Accounts Found?", rules: [{ field: "{{$nodes.Fetch At-Risk Accounts.output.data.count}}", operator: "greater_than", value: "0" }], logic: "all" } as MissionNode,
    { ...n("a1", 760, 120), type: "ai-generate", label: "CS Alert", prompt: "Write a churn risk alert for the customer success team. List top at-risk accounts by risk score, key signals, and suggested outreach actions for each.", integration: "claude", detailLevel: "standard" } as MissionNode,
    { ...n("o1", 980, 120), type: "slack-output", label: "Alert CS Team" } as MissionNode,
  ],
  [conn("c1", "t1", "h1"), conn("c2", "h1", "cond"), conn("c3", "cond", "a1", "true"), conn("c4", "a1", "o1")],
)

const NPS_SUMMARY: MissionTemplate = makeTemplate(
  "nps-weekly-summary",
  "NPS Weekly Summary",
  "Aggregate NPS survey responses and summarize themes for your product team.",
  "Get a weekly summary of NPS feedback with key themes and action items.",
  "customer_success",
  ["nps", "feedback", "customer", "weekly", "product"],
  "Star",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Friday at 4:00 PM", triggerMode: "weekly", triggerTime: "16:00", triggerDays: ["fri"] } as MissionNode,
    { ...n("h1", 320, 200), type: "http-request", label: "Fetch NPS Responses", method: "GET", url: "{{$vars.nps_api}}/responses?period=week", responseFormat: "json" } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-summarize", label: "NPS Theme Analysis", prompt: "Analyze these NPS responses. Summarize: avg score, top promoter themes, top detractor themes, and 3 prioritized product improvements.", integration: "claude", detailLevel: "detailed" } as MissionNode,
    { ...n("o1", 760, 200), type: "email-output", label: "Email Product Team" } as MissionNode,
  ],
  [conn("c1", "t1", "h1"), conn("c2", "h1", "a1"), conn("c3", "a1", "o1")],
)

// ─────────────────────────────────────────────────────────────────────────────
// HR Templates
// ─────────────────────────────────────────────────────────────────────────────

const NEW_HIRE_WELCOME: MissionTemplate = makeTemplate(
  "new-hire-welcome",
  "New Hire Welcome",
  "Trigger an onboarding welcome message when a new employee joins.",
  "Automatically send a personalized welcome package when a new hire is added to your HR system.",
  "hr",
  ["hr", "onboarding", "new-hire", "welcome"],
  "UserPlus",
  [
    { ...n("t1", 100, 200), type: "webhook-trigger", label: "HR System Webhook", method: "POST", path: "/new-hire", authentication: "bearer" } as MissionNode,
    { ...n("a1", 320, 200), type: "ai-generate", label: "Write Welcome Email", prompt: "Write a warm, professional welcome email for new employee {{$nodes.HR System Webhook.output.data.name}} joining the {{$nodes.HR System Webhook.output.data.team}} team. Include: welcome message, first day tips, who to reach for questions, and company culture highlights.", integration: "claude", detailLevel: "standard" } as MissionNode,
    { ...n("o1", 540, 200), type: "email-output", label: "Send Welcome Email" } as MissionNode,
  ],
  [conn("c1", "t1", "a1"), conn("c2", "a1", "o1")],
)

// ─────────────────────────────────────────────────────────────────────────────
// ECOMMERCE Templates
// ─────────────────────────────────────────────────────────────────────────────

const INVENTORY_ALERT: MissionTemplate = makeTemplate(
  "low-inventory-alert",
  "Low Inventory Alert",
  "Alert your operations team when product inventory falls below reorder thresholds.",
  "Automatically monitor your inventory levels and trigger reorder workflows.",
  "ecommerce",
  ["inventory", "ecommerce", "alert", "operations", "reorder"],
  "Package",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 8:00 AM", triggerMode: "daily", triggerTime: "08:00" } as MissionNode,
    { ...n("h1", 320, 200), type: "http-request", label: "Check Inventory", method: "GET", url: "{{$vars.inventory_api}}/products?stock_lt={{$vars.reorder_threshold}}", responseFormat: "json" } as MissionNode,
    { ...n("cond", 540, 200), type: "condition", label: "Low Stock?", rules: [{ field: "{{$nodes.Check Inventory.output.data.count}}", operator: "greater_than", value: "0" }], logic: "all" } as MissionNode,
    { ...n("a1", 760, 120), type: "ai-generate", label: "Inventory Alert", prompt: "Write an inventory alert for the operations team. List low-stock products, current vs reorder levels, and suggest purchase quantities.", integration: "claude", detailLevel: "concise" } as MissionNode,
    { ...n("o1", 980, 120), type: "email-output", label: "Alert Ops Team" } as MissionNode,
  ],
  [conn("c1", "t1", "h1"), conn("c2", "h1", "cond"), conn("c3", "cond", "a1", "true"), conn("c4", "a1", "o1")],
)

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL Templates
// ─────────────────────────────────────────────────────────────────────────────

const SOCIAL_TRENDS: MissionTemplate = makeTemplate(
  "social-trends-brief",
  "Social Trends Brief",
  "Daily snapshot of trending topics on social media relevant to your industry.",
  "Stay on top of what's trending on social media in your niche every day.",
  "social",
  ["social", "trends", "twitter", "daily", "viral"],
  "TrendingUp",
  [
    { ...n("t1", 100, 200), type: "schedule-trigger", label: "Daily at 10:00 AM", triggerMode: "daily", triggerTime: "10:00" } as MissionNode,
    { ...n("s1", 320, 200), type: "web-search", label: "Search Social Trends", query: "{{$vars.industry}} trending today viral twitter reddit", fetchContent: true } as MissionNode,
    { ...n("a1", 540, 200), type: "ai-summarize", label: "Trends Brief", prompt: "Summarize the top 5 trending topics in {{$vars.industry}} today on social media. For each: topic, why it's trending, engagement level, and content opportunity.", integration: "claude" } as MissionNode,
    { ...n("o1", 760, 200), type: "slack-output", label: "Post to #social" } as MissionNode,
  ],
  [conn("c1", "t1", "s1"), conn("c2", "s1", "a1"), conn("c3", "a1", "o1")],
)

// ─────────────────────────────────────────────────────────────────────────────
// Template Registry
// ─────────────────────────────────────────────────────────────────────────────

export const MISSION_TEMPLATES: MissionTemplate[] = [
  // Research
  MORNING_BRIEFING,
  COMPETITOR_MONITOR,
  TECH_DIGEST,
  INDUSTRY_REPORT,
  // Finance
  CRYPTO_PORTFOLIO,
  PRICE_ALERT,
  WEEKLY_PNL,
  MARKET_SNAPSHOT,
  EARNINGS_WATCH,
  // DevOps
  UPTIME_CHECK,
  ERROR_ALERT,
  DEPLOY_NOTIFIER,
  SSL_EXPIRY,
  // Marketing
  BRAND_MENTIONS,
  SEO_RANK_WATCH,
  AD_SPEND_ALERT,
  // Content
  CONTENT_IDEAS,
  RSS_SUMMARY,
  // Personal
  WEATHER_BRIEF,
  SPORTS_RECAP,
  HABIT_TRACKER,
  // Security
  VULN_SCAN,
  // Data Analytics
  API_METRICS,
  DATA_PIPELINE_ALERT,
  // Customer Success
  CHURN_RISK,
  NPS_SUMMARY,
  // HR
  NEW_HIRE_WELCOME,
  // Ecommerce
  INVENTORY_ALERT,
  // Social
  SOCIAL_TRENDS,
]

// ─────────────────────────────────────────────────────────────────────────────
// Lookup Helpers
// ─────────────────────────────────────────────────────────────────────────────

const _templateById = new Map(MISSION_TEMPLATES.map((t) => [t.id, t]))

export function getTemplate(id: string): MissionTemplate | undefined {
  return _templateById.get(id)
}

export function getTemplatesByCategory(category: MissionCategory): MissionTemplate[] {
  return MISSION_TEMPLATES.filter((t) => t.category === category)
}

export function searchTemplates(query: string): MissionTemplate[] {
  const q = query.toLowerCase().trim()
  if (!q) return MISSION_TEMPLATES
  return MISSION_TEMPLATES.filter(
    (t) =>
      t.label.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.includes(q)) ||
      t.useCase.toLowerCase().includes(q),
  )
}

/**
 * Instantiate a template into a full Mission with unique IDs.
 */
type InstantiateTemplateOverrides = Partial<Pick<Mission, "label" | "chatIds" | "integration">> & {
  aiIntegration?: Provider
  aiModel?: string
}

function applyAiDefaults(node: MissionNode, aiIntegration?: Provider, aiModel?: string): MissionNode {
  if (!aiIntegration) return { ...node }
  const normalizedModel = String(aiModel || "").trim()
  if (
    node.type === "ai-summarize" ||
    node.type === "ai-classify" ||
    node.type === "ai-extract" ||
    node.type === "ai-generate" ||
    node.type === "ai-chat"
  ) {
    return normalizedModel
      ? { ...node, integration: aiIntegration, model: normalizedModel }
      : { ...node, integration: aiIntegration }
  }
  return { ...node }
}

export function instantiateTemplate(template: MissionTemplate, userId: string, overrides?: InstantiateTemplateOverrides): Mission {
  const now = new Date().toISOString()
  const nodes = Array.isArray(template.blueprint.nodes)
    ? template.blueprint.nodes.map((node) => applyAiDefaults(node, overrides?.aiIntegration, overrides?.aiModel))
    : []
  const connections = Array.isArray(template.blueprint.connections)
    ? template.blueprint.connections.map((connection) => ({ ...connection }))
    : []
  return {
    ...template.blueprint,
    id: crypto.randomUUID(),
    userId,
    label: overrides?.label || template.blueprint.label,
    chatIds: overrides?.chatIds || [],
    integration: overrides?.integration || "telegram",
    nodes,
    connections,
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
  }
}
