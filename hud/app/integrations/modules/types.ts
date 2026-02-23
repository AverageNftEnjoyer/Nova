import type { CSSProperties, Dispatch, MutableRefObject, SetStateAction } from "react"

import type { IntegrationsSettings, LlmProvider } from "@/lib/integrations/client-store"
import type { IntegrationSetupKey } from "../components"
import type { IntegrationsSaveStatus, IntegrationsSaveTarget } from "../hooks"
import type { CoinbasePendingAction, CoinbasePersistedSnapshot, CoinbasePrivacySettings } from "./coinbase/meta"

type SetState<T> = Dispatch<SetStateAction<T>>

export type LlmSetupState = {
  apiKey: string
  setApiKey: (value: string) => void
  apiKeyConfigured: boolean
  apiKeyMasked: string
  baseUrl: string
  setBaseUrl: (value: string) => void
  model: string
  setModel: (value: string) => void
  modelOptions: Array<{ value: string; label: string; priceHint?: string }>
  toggle: () => Promise<void>
  save: () => Promise<void>
  persistedModel: string
}

export type ProviderDefinition = {
  sectionRef: MutableRefObject<HTMLElement | null>
  title: string
  description: string
  isConnected: boolean
  isSaving: boolean
  onToggle: () => Promise<void>
  onSave: () => Promise<void>
  apiKey: string
  onApiKeyChange: (value: string) => void
  apiKeyConfigured: boolean
  apiKeyMasked: string
  baseUrl: string
  onBaseUrlChange: (value: string) => void
  model: string
  onModelChange: (value: string) => void
  modelOptions: Array<{ value: string; label: string; priceHint?: string }>
  apiKeyPlaceholder: string
  apiKeyPlaceholderWhenConfigured: string
  apiKeyInputName: string
  baseUrlPlaceholder: string
  baseUrlHint: string
  costEstimate: string
  priceHint: string
  usageNote?: string
  instructionSteps: string[]
}

export type UseProviderDefinitionsParams = {
  settings: IntegrationsSettings
  isSavingTarget: IntegrationsSaveTarget
  activeSetup: IntegrationSetupKey
  openaiSetupSectionRef: MutableRefObject<HTMLElement | null>
  claudeSetupSectionRef: MutableRefObject<HTMLElement | null>
  grokSetupSectionRef: MutableRefObject<HTMLElement | null>
  geminiSetupSectionRef: MutableRefObject<HTMLElement | null>
  openAISetup: LlmSetupState
  claudeSetup: LlmSetupState
  grokSetup: LlmSetupState
  geminiSetup: LlmSetupState
}

export type UseIntegrationsActionsParams = {
  settings: IntegrationsSettings
  setSettings: SetState<IntegrationsSettings>
  setSaveStatus: SetState<IntegrationsSaveStatus>
  setIsSavingTarget: SetState<IntegrationsSaveTarget>
  isSavingTarget: IntegrationsSaveTarget
  activeSetup: IntegrationSetupKey
  integrationsHydrated: boolean
  activeLlmProvider: LlmProvider
  setActiveLlmProvider: SetState<LlmProvider>
  botToken: string
  setBotToken: SetState<string>
  botTokenConfigured: boolean
  setBotTokenConfigured: SetState<boolean>
  setBotTokenMasked: SetState<string>
  chatIds: string
  discordWebhookUrls: string
  braveApiKey: string
  braveApiKeyConfigured: boolean
  setBraveApiKey: SetState<string>
  setBraveApiKeyConfigured: SetState<boolean>
  setBraveApiKeyMasked: SetState<string>
  coinbaseApiKey: string
  setCoinbaseApiKey: SetState<string>
  coinbaseApiSecret: string
  setCoinbaseApiSecret: SetState<string>
  coinbaseApiKeyConfigured: boolean
  setCoinbaseApiKeyConfigured: SetState<boolean>
  coinbaseApiSecretConfigured: boolean
  setCoinbaseApiSecretConfigured: SetState<boolean>
  setCoinbaseApiKeyMasked: SetState<string>
  setCoinbaseApiSecretMasked: SetState<string>
  setCoinbasePersistedSnapshot: SetState<CoinbasePersistedSnapshot>
  coinbasePendingAction: CoinbasePendingAction | null
  setCoinbasePendingAction: SetState<CoinbasePendingAction | null>
  coinbasePrivacy: CoinbasePrivacySettings
  setCoinbasePrivacy: SetState<CoinbasePrivacySettings>
  coinbasePrivacyHydrated: boolean
  setCoinbasePrivacyHydrated: SetState<boolean>
  coinbasePrivacySaving: boolean
  setCoinbasePrivacySaving: SetState<boolean>
  setCoinbasePrivacyError: SetState<string>
  openAISetup: LlmSetupState
  claudeSetup: LlmSetupState
  grokSetup: LlmSetupState
  geminiSetup: LlmSetupState
}

export type IntegrationsMainPanelProps = {
  activeSetup: IntegrationSetupKey
  panelStyle: CSSProperties | undefined
  panelClass: string
  moduleHeightClass: string
  isLight: boolean
  subPanelClass: string
  settings: IntegrationsSettings
  isSavingTarget: IntegrationsSaveTarget
  braveNeedsKeyWarning: boolean
  braveApiKeyConfigured: boolean
  braveApiKeyMasked: string
  coinbaseNeedsKeyWarning: boolean
  coinbasePendingAction: CoinbasePendingAction | null
  coinbaseSyncBadgeClass: string
  coinbaseSyncLabel: string
  coinbaseLastSyncText: string
  coinbaseFreshnessText: string
  coinbaseErrorText: string
  coinbaseHasKeys: boolean
  coinbaseScopeSummary: string
  coinbasePrivacy: CoinbasePrivacySettings
  coinbasePrivacyHydrated: boolean
  coinbasePrivacySaving: boolean
  coinbasePrivacyError: string
  coinbaseApiKey: string
  setCoinbaseApiKey: SetState<string>
  showCoinbaseApiKey: boolean
  setShowCoinbaseApiKey: SetState<boolean>
  coinbaseApiKeyConfigured: boolean
  coinbaseApiKeyMasked: string
  coinbaseApiSecret: string
  setCoinbaseApiSecret: SetState<string>
  showCoinbaseApiSecret: boolean
  setShowCoinbaseApiSecret: SetState<boolean>
  coinbaseApiSecretConfigured: boolean
  coinbaseApiSecretMasked: string
  providerDefinition: ProviderDefinition | null
  gmailSetup: {
    gmailClientId: string
    setGmailClientId: (value: string) => void
    gmailClientSecret: string
    setGmailClientSecret: (value: string) => void
    gmailClientSecretConfigured: boolean
    gmailClientSecretMasked: string
    gmailRedirectUri: string
    setGmailRedirectUri: (value: string) => void
    selectedGmailAccountId: string
    setSelectedGmailAccountId: (value: string) => void
    saveGmailConfig: () => void
    connectGmail: () => void
    disconnectGmail: (accountId?: string) => void
    setPrimaryGmailAccount: (accountId: string) => void
    updateGmailAccountState: (action: "set_enabled" | "delete", accountId: string, enabled?: boolean) => void
  }
  telegramSetupSectionRef: MutableRefObject<HTMLElement | null>
  discordSetupSectionRef: MutableRefObject<HTMLElement | null>
  braveSetupSectionRef: MutableRefObject<HTMLElement | null>
  coinbaseSetupSectionRef: MutableRefObject<HTMLElement | null>
  gmailSetupSectionRef: MutableRefObject<HTMLElement | null>
  setBotToken: SetState<string>
  botToken: string
  botTokenConfigured: boolean
  botTokenMasked: string
  setChatIds: SetState<string>
  chatIds: string
  setDiscordWebhookUrls: SetState<string>
  discordWebhookUrls: string
  setBraveApiKey: SetState<string>
  braveApiKey: string
  toggleTelegram: () => Promise<void>
  saveTelegramConfig: () => Promise<void>
  toggleDiscord: () => Promise<void>
  saveDiscordConfig: () => Promise<void>
  toggleBrave: () => Promise<void>
  saveBraveConfig: () => Promise<void>
  probeCoinbaseConnection: (successMessage?: string) => Promise<void>
  toggleCoinbase: () => Promise<void>
  saveCoinbaseConfig: () => Promise<void>
  updateCoinbasePrivacy: (patch: Partial<CoinbasePrivacySettings>) => Promise<void>
  updateCoinbaseDefaults: (partial: Partial<IntegrationsSettings["coinbase"]>) => void
}
