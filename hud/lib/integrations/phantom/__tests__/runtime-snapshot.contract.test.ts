import assert from "node:assert/strict"
import test from "node:test"

import { buildRuntimeSafePhantomSnapshot } from "../runtime-safe.ts"
import type { PhantomIntegrationConfig } from "../types.ts"

function buildConfig(): PhantomIntegrationConfig {
  return {
    connected: true,
    provider: "phantom",
    chain: "solana",
    walletAddress: "7xKXtg2CWx3M4r2P4fJ4B7AB9YQ1y3sC5fXxkD7UoNfN",
    walletLabel: "7xKX...oNfN",
    connectedAt: "2026-03-06T15:00:00.000Z",
    verifiedAt: "2026-03-06T15:01:00.000Z",
    lastDisconnectedAt: "",
    evmAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    evmLabel: "0xab...abcd",
    evmChainId: "0x89",
    evmConnectedAt: "2026-03-06T15:01:30.000Z",
    preferences: {
      allowAgentWalletContext: true,
      allowAgentEvmContext: true,
      allowApprovalGatedPolymarket: true,
    },
    capabilities: {
      signMessage: true,
      walletOwnershipProof: true,
      solanaConnected: true,
      solanaVerified: true,
      evmAvailable: true,
      approvalGatedPolymarket: true,
      approvalGatedPolymarketReady: true,
      autonomousTrading: false,
    },
  }
}

test("integration: runtime snapshot contract emits wallet-safe phantom metadata", () => {
  const snapshot = buildRuntimeSafePhantomSnapshot(buildConfig())
  assert.equal(snapshot.connected, true)
  assert.equal(snapshot.provider, "phantom")
  assert.equal(snapshot.chain, "solana")
  assert.equal(snapshot.walletAddress, "7xKXtg2CWx3M4r2P4fJ4B7AB9YQ1y3sC5fXxkD7UoNfN")
  assert.equal(snapshot.walletLabel, "7xKX...oNfN")
  assert.equal(snapshot.evmAddress, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
  assert.equal(snapshot.evmChainId, "0x89")
  assert.equal(snapshot.capabilities.evmAvailable, true)
  assert.equal(snapshot.capabilities.approvalGatedPolymarketReady, true)
  assert.equal(snapshot.capabilities.autonomousTrading, false)
  const serialized = JSON.stringify(snapshot)
  assert.equal(serialized.includes("seed"), false)
  assert.equal(serialized.includes("privateKey"), false)
  assert.equal(serialized.includes("mnemonic"), false)
})

test("integration: runtime snapshot honors disabled Phantom exposure settings", () => {
  const snapshot = buildRuntimeSafePhantomSnapshot({
    ...buildConfig(),
    preferences: {
      allowAgentWalletContext: false,
      allowAgentEvmContext: false,
      allowApprovalGatedPolymarket: false,
    },
    capabilities: {
      ...buildConfig().capabilities,
      evmAvailable: false,
      approvalGatedPolymarket: false,
      approvalGatedPolymarketReady: false,
    },
  })
  assert.equal(snapshot.walletAddress, "")
  assert.equal(snapshot.walletLabel, "")
  assert.equal(snapshot.evmAddress, "")
  assert.equal(snapshot.evmChainId, "")
  assert.equal(snapshot.preferences.allowAgentWalletContext, false)
  assert.equal(snapshot.preferences.allowAgentEvmContext, false)
  assert.equal(snapshot.preferences.allowApprovalGatedPolymarket, false)
})
