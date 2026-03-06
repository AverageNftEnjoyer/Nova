export const PHANTOM_PROVIDER_ID = "phantom" as const
export const PHANTOM_CHAIN_ID = "solana" as const
export const PHANTOM_SOLANA_SIGN_IN_VERSION = "1" as const
export const PHANTOM_SOLANA_SIGN_IN_CHAIN_ID = "solana:mainnet" as const

export interface PhantomCapabilityFlags {
  signMessage: boolean
  walletOwnershipProof: boolean
  solanaConnected: boolean
  solanaVerified: boolean
  evmAvailable: boolean
  approvalGatedPolymarket: boolean
  approvalGatedPolymarketReady: boolean
  autonomousTrading: boolean
}

export interface PhantomUserSettings {
  allowAgentWalletContext: boolean
  allowAgentEvmContext: boolean
  allowApprovalGatedPolymarket: boolean
}

export interface PhantomIntegrationConfig {
  connected: boolean
  provider: typeof PHANTOM_PROVIDER_ID
  chain: typeof PHANTOM_CHAIN_ID
  walletAddress: string
  walletLabel: string
  connectedAt: string
  verifiedAt: string
  lastDisconnectedAt: string
  evmAddress: string
  evmLabel: string
  evmChainId: string
  evmConnectedAt: string
  preferences: PhantomUserSettings
  capabilities: PhantomCapabilityFlags
}

export interface PhantomAuthChallenge {
  challengeId: string
  walletAddress: string
  walletLabel: string
  message: string
  nonce: string
  origin: string
  domain: string
  uri: string
  statement: string
  versionLabel: string
  chainId: string
  resources: string[]
  issuedAt: string
  expiresAt: string
  accessTokenHash: string
  version: number
}

export interface PhantomWalletAuthState {
  version: number
  currentChallenge: PhantomAuthChallenge | null
  lastVerifiedWalletAddress: string
  lastVerifiedAt: string
  lastDisconnectedAt: string
  lastInvalidationReason: string
  updatedAt: string
}

export interface PhantomChallengeResponse {
  provider: typeof PHANTOM_PROVIDER_ID
  chain: typeof PHANTOM_CHAIN_ID
  walletAddress: string
  walletLabel: string
  challengeId: string
  message: string
  messageKind: "siws"
  issuedAt: string
  expiresAt: string
  capabilities: PhantomCapabilityFlags
}

export interface PhantomVerificationResult {
  provider: typeof PHANTOM_PROVIDER_ID
  chain: typeof PHANTOM_CHAIN_ID
  connected: boolean
  walletAddress: string
  walletLabel: string
  connectedAt: string
  verifiedAt: string
  lastDisconnectedAt?: string
  evmAddress: string
  evmLabel: string
  evmChainId: string
  evmConnectedAt: string
  capabilities: PhantomCapabilityFlags
}

export type PhantomDisconnectReason =
  | "user_disconnect"
  | "wallet_changed"
  | "session_revoked"
  | "verification_reset"
  | "unknown"

export const DEFAULT_PHANTOM_CAPABILITIES: PhantomCapabilityFlags = {
  signMessage: true,
  walletOwnershipProof: true,
  solanaConnected: false,
  solanaVerified: false,
  evmAvailable: false,
  approvalGatedPolymarket: true,
  approvalGatedPolymarketReady: false,
  autonomousTrading: false,
}

export const DEFAULT_PHANTOM_USER_SETTINGS: PhantomUserSettings = {
  allowAgentWalletContext: true,
  allowAgentEvmContext: true,
  allowApprovalGatedPolymarket: true,
}

export const DEFAULT_PHANTOM_INTEGRATION_CONFIG: PhantomIntegrationConfig = {
  connected: false,
  provider: PHANTOM_PROVIDER_ID,
  chain: PHANTOM_CHAIN_ID,
  walletAddress: "",
  walletLabel: "",
  connectedAt: "",
  verifiedAt: "",
  lastDisconnectedAt: "",
  evmAddress: "",
  evmLabel: "",
  evmChainId: "",
  evmConnectedAt: "",
  preferences: { ...DEFAULT_PHANTOM_USER_SETTINGS },
  capabilities: { ...DEFAULT_PHANTOM_CAPABILITIES },
}

export const DEFAULT_PHANTOM_WALLET_AUTH_STATE: PhantomWalletAuthState = {
  version: 0,
  currentChallenge: null,
  lastVerifiedWalletAddress: "",
  lastVerifiedAt: "",
  lastDisconnectedAt: "",
  lastInvalidationReason: "",
  updatedAt: "",
}

function sanitizeIsoString(value: unknown): string {
  const normalized = String(value || "").trim()
  if (!normalized) return ""
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ""
}

export function maskPhantomWalletAddress(value: unknown): string {
  const normalized = String(value || "").trim()
  if (!normalized) return ""
  if (normalized.length <= 10) return normalized
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`
}

export function normalizePhantomCapabilities(raw: unknown): PhantomCapabilityFlags {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PHANTOM_CAPABILITIES }
  const source = raw as Partial<PhantomCapabilityFlags>
  return {
    signMessage: source.signMessage !== false,
    walletOwnershipProof: source.walletOwnershipProof !== false,
    solanaConnected: source.solanaConnected === true,
    solanaVerified: source.solanaVerified === true,
    evmAvailable: source.evmAvailable === true,
    approvalGatedPolymarket: source.approvalGatedPolymarket !== false,
    approvalGatedPolymarketReady: source.approvalGatedPolymarketReady === true,
    autonomousTrading: source.autonomousTrading === true,
  }
}

export function normalizePhantomUserSettings(raw: unknown): PhantomUserSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PHANTOM_USER_SETTINGS }
  const source = raw as Partial<PhantomUserSettings>
  return {
    allowAgentWalletContext: source.allowAgentWalletContext !== false,
    allowAgentEvmContext: source.allowAgentEvmContext !== false,
    allowApprovalGatedPolymarket: source.allowApprovalGatedPolymarket !== false,
  }
}

export function normalizeEthereumWalletAddress(value: unknown): string {
  const normalized = String(value || "").trim()
  if (!normalized) return ""
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) return ""
  return normalized.toLowerCase()
}

export function normalizePhantomIntegrationConfig(raw: unknown): PhantomIntegrationConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PHANTOM_INTEGRATION_CONFIG }
  const source = raw as Partial<PhantomIntegrationConfig>
  const walletAddress = String(source.walletAddress || "").trim()
  const connected = Boolean(source.connected) && walletAddress.length > 0
  const evmAddress = normalizeEthereumWalletAddress(source.evmAddress)
  const verifiedAt = connected ? sanitizeIsoString(source.verifiedAt) : ""
  const preferences = normalizePhantomUserSettings(source.preferences)
  const capabilities = normalizePhantomCapabilities(source.capabilities)
  return {
    connected,
    provider: PHANTOM_PROVIDER_ID,
    chain: PHANTOM_CHAIN_ID,
    walletAddress: connected ? walletAddress : "",
    walletLabel: connected ? maskPhantomWalletAddress(walletAddress) : "",
    connectedAt: connected ? sanitizeIsoString(source.connectedAt) : "",
    verifiedAt,
    lastDisconnectedAt: sanitizeIsoString(source.lastDisconnectedAt),
    evmAddress,
    evmLabel: evmAddress ? maskPhantomWalletAddress(evmAddress) : "",
    evmChainId: String(source.evmChainId || "").trim(),
    evmConnectedAt: evmAddress ? sanitizeIsoString(source.evmConnectedAt) : "",
    preferences,
    capabilities: {
      ...capabilities,
      solanaConnected: connected,
      solanaVerified: connected && verifiedAt.length > 0,
      evmAvailable: preferences.allowAgentEvmContext && (capabilities.evmAvailable || evmAddress.length > 0),
      approvalGatedPolymarket: preferences.allowApprovalGatedPolymarket,
      approvalGatedPolymarketReady:
        preferences.allowApprovalGatedPolymarket &&
        preferences.allowAgentEvmContext &&
        (capabilities.approvalGatedPolymarketReady || (connected && evmAddress.length > 0)),
    },
  }
}

export function normalizePhantomWalletAuthState(raw: unknown): PhantomWalletAuthState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PHANTOM_WALLET_AUTH_STATE }
  const source = raw as Partial<PhantomWalletAuthState>
  const challengeSource =
    source.currentChallenge && typeof source.currentChallenge === "object"
      ? (source.currentChallenge as Partial<PhantomAuthChallenge>)
      : null

  const currentChallenge = challengeSource
    ? {
        challengeId: String(challengeSource.challengeId || "").trim(),
        walletAddress: String(challengeSource.walletAddress || "").trim(),
        walletLabel: maskPhantomWalletAddress(challengeSource.walletAddress),
        message: String(challengeSource.message || ""),
        nonce: String(challengeSource.nonce || "").trim(),
        origin: String(challengeSource.origin || "").trim(),
        domain: String(challengeSource.domain || "").trim(),
        uri: String(challengeSource.uri || "").trim(),
        statement: String(challengeSource.statement || "").trim(),
        versionLabel: String(challengeSource.versionLabel || "").trim(),
        chainId: String(challengeSource.chainId || "").trim(),
        resources: Array.isArray(challengeSource.resources)
          ? challengeSource.resources.map((entry) => String(entry || "").trim()).filter(Boolean)
          : [],
        issuedAt: sanitizeIsoString(challengeSource.issuedAt),
        expiresAt: sanitizeIsoString(challengeSource.expiresAt),
        accessTokenHash: String(challengeSource.accessTokenHash || "").trim(),
        version:
          typeof challengeSource.version === "number" && Number.isFinite(challengeSource.version)
            ? Math.max(0, Math.floor(challengeSource.version))
            : 0,
      }
    : null

  const hasValidChallenge =
    currentChallenge &&
    currentChallenge.challengeId &&
    currentChallenge.walletAddress &&
    currentChallenge.message &&
    currentChallenge.nonce &&
    currentChallenge.domain &&
    currentChallenge.uri &&
    currentChallenge.statement &&
    currentChallenge.versionLabel &&
    currentChallenge.chainId &&
    currentChallenge.issuedAt &&
    currentChallenge.expiresAt &&
    currentChallenge.accessTokenHash

  return {
    version:
      typeof source.version === "number" && Number.isFinite(source.version)
        ? Math.max(0, Math.floor(source.version))
        : 0,
    currentChallenge: hasValidChallenge ? currentChallenge : null,
    lastVerifiedWalletAddress: String(source.lastVerifiedWalletAddress || "").trim(),
    lastVerifiedAt: sanitizeIsoString(source.lastVerifiedAt),
    lastDisconnectedAt: sanitizeIsoString(source.lastDisconnectedAt),
    lastInvalidationReason: String(source.lastInvalidationReason || "").trim().slice(0, 64),
    updatedAt: sanitizeIsoString(source.updatedAt),
  }
}
