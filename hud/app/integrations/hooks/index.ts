// Hooks
export { useSpotlightEffect, type SpotlightSectionRef } from "./useSpotlightEffect"
export { useBackgroundVideo } from "./useBackgroundVideo"
export { useOpenAISetup } from "./use-openai-setup"
export { useClaudeSetup } from "./use-claude-setup"
export { useGrokSetup } from "./use-grok-setup"
export { useGeminiSetup } from "./use-gemini-setup"
export { useGmailSetup } from "./use-gmail-setup"
export { useGmailCalendarSetup } from "./use-gmail-calendar-setup"
export type { IntegrationsSaveStatus, IntegrationsSaveTarget } from "./use-llm-provider-setup"

// Theme utilities
export {
  resolveThemeBackground,
  normalizeCachedBackground,
  resolveCustomBackgroundIsImage,
} from "./useThemeBackground"

// Gmail utilities
export { normalizeGmailAccountsForUi, type GmailAccountForUi } from "./gmail-utils"
