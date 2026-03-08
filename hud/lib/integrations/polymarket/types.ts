export type PolymarketSignatureType = 0 | 1 | 2

export interface PolymarketIntegrationConfig {
  connected: boolean
  walletAddress: string
  profileAddress: string
  username: string
  pseudonym: string
  profileImageUrl: string
  signatureType: PolymarketSignatureType
  liveTradingEnabled: boolean
  lastConnectedAt: string
  lastProfileSyncAt: string
}

export const DEFAULT_POLYMARKET_INTEGRATION_CONFIG: PolymarketIntegrationConfig = {
  connected: false,
  walletAddress: "",
  profileAddress: "",
  username: "",
  pseudonym: "",
  profileImageUrl: "",
  signatureType: 0,
  liveTradingEnabled: false,
  lastConnectedAt: "",
  lastProfileSyncAt: "",
}

function normalizeIsoString(value: unknown): string {
  const normalized = String(value || "").trim()
  if (!normalized) return ""
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ""
}

function normalizeEvmAddress(value: unknown): string {
  const normalized = String(value || "").trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) return ""
  return normalized.toLowerCase()
}

function normalizeSignatureType(value: unknown): PolymarketSignatureType {
  if (value === 1 || value === "1") return 1
  if (value === 2 || value === "2") return 2
  return 0
}

export function getPolymarketPositionsAddress(config: Pick<PolymarketIntegrationConfig, "profileAddress" | "walletAddress">): string {
  return String(config.profileAddress || "").trim() || String(config.walletAddress || "").trim()
}

export function normalizePolymarketIntegrationConfig(raw: unknown): PolymarketIntegrationConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_POLYMARKET_INTEGRATION_CONFIG }
  const source = raw as Partial<PolymarketIntegrationConfig>
  const walletAddress = normalizeEvmAddress(source.walletAddress)
  const profileAddress = normalizeEvmAddress(source.profileAddress)
  const connected = Boolean(source.connected) && walletAddress.length > 0
  return {
    connected,
    walletAddress: connected ? walletAddress : "",
    profileAddress: connected ? profileAddress : "",
    username: connected ? String(source.username || "").trim().slice(0, 128) : "",
    pseudonym: connected ? String(source.pseudonym || "").trim().slice(0, 128) : "",
    profileImageUrl: connected ? String(source.profileImageUrl || "").trim().slice(0, 512) : "",
    signatureType: normalizeSignatureType(source.signatureType),
    liveTradingEnabled: connected && source.liveTradingEnabled === true,
    lastConnectedAt: connected ? normalizeIsoString(source.lastConnectedAt) : "",
    lastProfileSyncAt: connected ? normalizeIsoString(source.lastProfileSyncAt) : "",
  }
}
