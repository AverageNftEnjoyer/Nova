export const INTEGRATION_SETUP_KEYS = [
  "telegram",
  "discord",
  "slack",
  "brave",
  "news",
  "coinbase",
  "phantom",
  "polymarket",
  "openai",
  "claude",
  "grok",
  "gemini",
  "spotify",
  "youtube",
  "gmail",
  "gmail-calendar",
] as const

export type IntegrationSetupKey = typeof INTEGRATION_SETUP_KEYS[number]

export function isIntegrationSetupKey(value: unknown): value is IntegrationSetupKey {
  return typeof value === "string" && INTEGRATION_SETUP_KEYS.includes(value as IntegrationSetupKey)
}

export function readIntegrationSetupParam(value: unknown): IntegrationSetupKey | null {
  return isIntegrationSetupKey(value) ? value : null
}

export function buildIntegrationsHref(setup?: IntegrationSetupKey | null): string {
  if (!setup) return "/integrations"
  return `/integrations?setup=${encodeURIComponent(setup)}`
}

const INTEGRATION_SETUP_LABELS: Readonly<Record<IntegrationSetupKey, string>> = {
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  brave: "Brave",
  news: "News",
  coinbase: "Coinbase",
  phantom: "Phantom",
  polymarket: "Polymarket",
  openai: "OpenAI",
  claude: "Claude",
  grok: "Grok",
  gemini: "Gemini",
  spotify: "Spotify",
  youtube: "YouTube",
  gmail: "Gmail",
  "gmail-calendar": "Google Calendar",
}

/** The integration's display name ("Google Calendar" for `gmail-calendar`). */
export function integrationSetupLabel(setup: IntegrationSetupKey): string {
  return INTEGRATION_SETUP_LABELS[setup]
}
