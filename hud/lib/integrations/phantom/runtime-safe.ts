import type { PhantomIntegrationConfig } from "./types.ts"

export interface RuntimeSafePhantomSnapshot {
  connected: boolean
  provider: "phantom"
  chain: "solana"
  walletAddress: string
  walletLabel: string
  connectedAt: string
  verifiedAt: string
  lastDisconnectedAt: string
  evmAddress: string
  evmLabel: string
  evmChainId: string
  evmConnectedAt: string
  preferences: {
    allowAgentWalletContext: boolean
    allowAgentEvmContext: boolean
    allowApprovalGatedPolymarket: boolean
  }
  capabilities: {
    signMessage: boolean
    walletOwnershipProof: boolean
    solanaConnected: boolean
    solanaVerified: boolean
    evmAvailable: boolean
    approvalGatedPolymarket: boolean
    approvalGatedPolymarketReady: boolean
    autonomousTrading: boolean
  }
}

export function buildRuntimeSafePhantomSnapshot(phantom: PhantomIntegrationConfig): RuntimeSafePhantomSnapshot {
  const allowAgentWalletContext = phantom.preferences.allowAgentWalletContext !== false
  const allowAgentEvmContext = phantom.preferences.allowAgentEvmContext !== false
  return {
    connected: Boolean(phantom.connected),
    provider: "phantom",
    chain: "solana",
    walletAddress: allowAgentWalletContext ? String(phantom.walletAddress || "").trim() : "",
    walletLabel: allowAgentWalletContext ? String(phantom.walletLabel || "").trim() : "",
    connectedAt: String(phantom.connectedAt || "").trim(),
    verifiedAt: String(phantom.verifiedAt || "").trim(),
    lastDisconnectedAt: String(phantom.lastDisconnectedAt || "").trim(),
    evmAddress: allowAgentEvmContext ? String(phantom.evmAddress || "").trim() : "",
    evmLabel: allowAgentEvmContext ? String(phantom.evmLabel || "").trim() : "",
    evmChainId: allowAgentEvmContext ? String(phantom.evmChainId || "").trim() : "",
    evmConnectedAt: allowAgentEvmContext ? String(phantom.evmConnectedAt || "").trim() : "",
    preferences: {
      allowAgentWalletContext,
      allowAgentEvmContext,
      allowApprovalGatedPolymarket: phantom.preferences.allowApprovalGatedPolymarket !== false,
    },
    capabilities: {
      signMessage: phantom.capabilities.signMessage !== false,
      walletOwnershipProof: phantom.capabilities.walletOwnershipProof !== false,
      solanaConnected: phantom.capabilities.solanaConnected === true,
      solanaVerified: phantom.capabilities.solanaVerified === true,
      evmAvailable: allowAgentEvmContext && phantom.capabilities.evmAvailable === true,
      approvalGatedPolymarket: phantom.capabilities.approvalGatedPolymarket !== false,
      approvalGatedPolymarketReady: phantom.capabilities.approvalGatedPolymarketReady === true,
      autonomousTrading: phantom.capabilities.autonomousTrading === true,
    },
  }
}
