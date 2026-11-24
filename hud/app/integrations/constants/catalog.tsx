import type { ReactNode } from "react"
import { OpenAI } from "@lobehub/icons"

import {
  BraveIcon,
  ClaudeIcon,
  CoinbaseIcon,
  DiscordIcon,
  GeminiIcon,
  GmailCalendarIcon,
  GmailIcon,
  NewsIcon,
  PhantomIcon,
  PolymarketIcon,
  SlackIcon,
  SpotifyIcon,
  TelegramIcon,
  XAIIcon,
  YouTubeIcon,
} from "@/components/icons"
import { integrationSetupLabel, type IntegrationSetupKey } from "@/lib/integrations/navigation"

export type IntegrationCategory = "models" | "communication" | "finance" | "media"

export interface IntegrationCatalogEntry {
  key: IntegrationSetupKey
  label: string
  category: IntegrationCategory
  /** One line: what connecting it lets Nova do. */
  purpose: string
}

export const INTEGRATION_CATEGORIES: ReadonlyArray<{ id: IntegrationCategory; label: string }> = [
  { id: "models", label: "Models" },
  { id: "communication", label: "Communication" },
  { id: "finance", label: "Finance" },
  { id: "media", label: "Media and web" },
]

const PURPOSE: Readonly<Record<IntegrationSetupKey, string>> = {
  openai: "GPT models for chat, agent tasks and missions.",
  claude: "Anthropic Claude models for chat, agent tasks and missions.",
  gemini: "Google Gemini models for chat, agent tasks and missions.",
  grok: "xAI Grok models for chat, agent tasks and missions.",
  gmail: "Read, summarise and send email from chat and missions.",
  "gmail-calendar": "Read and manage calendar events, shown on the mission calendar.",
  slack: "Post mission results and notifications to a Slack channel.",
  discord: "Post mission results and notifications through Discord webhooks.",
  telegram: "Send mission results and notifications through a Telegram bot.",
  coinbase: "Crypto prices, portfolio reports and automations from your Coinbase account.",
  phantom: "Verify a Phantom wallet so agents can use its address as context.",
  polymarket: "Bind your Phantom EVM wallet to Polymarket for markets and approved trades.",
  spotify: "Control Spotify playback from chat and see what is playing.",
  youtube: "YouTube feed, search and video details for chat and Home.",
  brave: "Web search and page fetches for chat and missions.",
  news: "Live headlines for the Home feed and news missions.",
}

const CATEGORY: Readonly<Record<IntegrationSetupKey, IntegrationCategory>> = {
  openai: "models",
  claude: "models",
  gemini: "models",
  grok: "models",
  gmail: "communication",
  "gmail-calendar": "communication",
  slack: "communication",
  discord: "communication",
  telegram: "communication",
  coinbase: "finance",
  phantom: "finance",
  polymarket: "finance",
  spotify: "media",
  youtube: "media",
  brave: "media",
  news: "media",
}

/** Display order inside each category. */
const ORDER: readonly IntegrationSetupKey[] = [
  "openai",
  "claude",
  "gemini",
  "grok",
  "gmail",
  "gmail-calendar",
  "slack",
  "discord",
  "telegram",
  "coinbase",
  "phantom",
  "polymarket",
  "spotify",
  "youtube",
  "brave",
  "news",
]

export const INTEGRATION_CATALOG: readonly IntegrationCatalogEntry[] = ORDER.map((key) => ({
  key,
  label: integrationSetupLabel(key),
  category: CATEGORY[key],
  purpose: PURPOSE[key],
}))

export const LLM_SETUP_KEYS = ["openai", "claude", "gemini", "grok"] as const
export type LlmSetupKey = (typeof LLM_SETUP_KEYS)[number]

export function isLlmSetupKey(key: IntegrationSetupKey): key is LlmSetupKey {
  return (LLM_SETUP_KEYS as readonly string[]).includes(key)
}

export function catalogEntry(key: IntegrationSetupKey): IntegrationCatalogEntry {
  return INTEGRATION_CATALOG.find((entry) => entry.key === key) ?? INTEGRATION_CATALOG[0]
}

/**
 * The integration's brand mark. Brand colours stay inside the mark; OpenAI and xAI are monochrome marks drawn in the
 * current text colour so they read in both themes.
 */
export function IntegrationIcon({ setup, className = "size-4" }: { setup: IntegrationSetupKey; className?: string }): ReactNode {
  switch (setup) {
    case "openai":
      return <OpenAI size={16} className={className} aria-hidden="true" />
    case "claude":
      return <ClaudeIcon size={16} className={className} aria-hidden="true" />
    case "gemini":
      return <GeminiIcon size={16} className={className} aria-hidden="true" />
    case "grok":
      return <XAIIcon size={16} className={className} aria-hidden="true" />
    case "gmail":
      return <GmailIcon className={className} />
    case "gmail-calendar":
      return <GmailCalendarIcon className={className} />
    case "slack":
      return <SlackIcon className={className} />
    case "discord":
      return <DiscordIcon className={className} />
    case "telegram":
      return <TelegramIcon className={className} />
    case "coinbase":
      return <CoinbaseIcon className={className} />
    case "phantom":
      return <PhantomIcon className={className} />
    case "polymarket":
      return <PolymarketIcon className={className} />
    case "spotify":
      return <SpotifyIcon className={className} />
    case "youtube":
      return <YouTubeIcon className={className} />
    case "brave":
      return <BraveIcon className={className} />
    case "news":
      return <NewsIcon className={className} />
  }
}
