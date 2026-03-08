import type { PolymarketIntegrationConfig } from "./types"
import { getPolymarketPositionsAddress } from "./types"

export interface RuntimeSafePolymarketSnapshot {
  connected: boolean
  walletAddress: string
  profileAddress: string
  positionsAddress: string
  username: string
  pseudonym: string
  profileImageUrl: string
  signatureType: 0 | 1 | 2
  liveTradingEnabled: boolean
  lastConnectedAt: string
  lastProfileSyncAt: string
}

export function buildRuntimeSafePolymarketSnapshot(config: PolymarketIntegrationConfig): RuntimeSafePolymarketSnapshot {
  return {
    connected: Boolean(config.connected),
    walletAddress: String(config.walletAddress || "").trim(),
    profileAddress: String(config.profileAddress || "").trim(),
    positionsAddress: getPolymarketPositionsAddress(config),
    username: String(config.username || "").trim(),
    pseudonym: String(config.pseudonym || "").trim(),
    profileImageUrl: String(config.profileImageUrl || "").trim(),
    signatureType: config.signatureType === 1 ? 1 : config.signatureType === 2 ? 2 : 0,
    liveTradingEnabled: config.liveTradingEnabled === true,
    lastConnectedAt: String(config.lastConnectedAt || "").trim(),
    lastProfileSyncAt: String(config.lastProfileSyncAt || "").trim(),
  }
}
