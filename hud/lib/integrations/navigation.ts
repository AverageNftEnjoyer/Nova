export const INTEGRATION_SETUP_KEYS = [
  "telegram",
  "discord",
  "slack",
  "brave",
  "news",
  "coinbase",
  "phantom",
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
