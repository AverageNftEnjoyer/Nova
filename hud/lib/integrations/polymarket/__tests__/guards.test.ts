import assert from "node:assert/strict"
import test from "node:test"

import { DEFAULT_PHANTOM_INTEGRATION_CONFIG, normalizePhantomIntegrationConfig } from "../../phantom/types.ts"
import {
  isVerifiedPhantomEvmReadyForPolymarket,
  shouldResetPolymarketForPhantomIdentity,
  validatePolymarketWalletBinding,
} from "../guards.ts"

const VERIFIED_EVM_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const OTHER_EVM_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

function buildVerifiedPhantom(overrides: Partial<ReturnType<typeof normalizePhantomIntegrationConfig>> = {}) {
  return normalizePhantomIntegrationConfig({
    ...DEFAULT_PHANTOM_INTEGRATION_CONFIG,
    connected: true,
    walletAddress: "So11111111111111111111111111111111111111112",
    verifiedAt: "2026-03-08T10:00:00.000Z",
    evmAddress: VERIFIED_EVM_ADDRESS,
    evmChainId: "137",
    evmConnectedAt: "2026-03-08T10:00:00.000Z",
    ...overrides,
  })
}

test("polymarket guards require a verified Phantom EVM identity", () => {
  assert.equal(isVerifiedPhantomEvmReadyForPolymarket(buildVerifiedPhantom()), true)
  assert.equal(isVerifiedPhantomEvmReadyForPolymarket(buildVerifiedPhantom({ verifiedAt: "" })), false)
  assert.equal(isVerifiedPhantomEvmReadyForPolymarket(buildVerifiedPhantom({ evmAddress: "" })), false)
  assert.equal(isVerifiedPhantomEvmReadyForPolymarket(buildVerifiedPhantom({ connected: false })), false)
})

test("polymarket guards invalidate stale bindings when Phantom identity changes or disappears", () => {
  assert.equal(
    shouldResetPolymarketForPhantomIdentity(
      { connected: true, walletAddress: VERIFIED_EVM_ADDRESS },
      buildVerifiedPhantom(),
    ),
    false,
  )
  assert.equal(
    shouldResetPolymarketForPhantomIdentity(
      { connected: true, walletAddress: VERIFIED_EVM_ADDRESS },
      buildVerifiedPhantom({ evmAddress: OTHER_EVM_ADDRESS }),
    ),
    true,
  )
  assert.equal(
    shouldResetPolymarketForPhantomIdentity(
      { connected: true, walletAddress: VERIFIED_EVM_ADDRESS },
      buildVerifiedPhantom({ verifiedAt: "" }),
    ),
    true,
  )
  assert.equal(
    shouldResetPolymarketForPhantomIdentity(
      { connected: false, walletAddress: VERIFIED_EVM_ADDRESS },
      buildVerifiedPhantom({ verifiedAt: "" }),
    ),
    false,
  )
})

test("polymarket guards only allow wallet binding to the verified Phantom EVM wallet", () => {
  const phantom = buildVerifiedPhantom()

  assert.deepEqual(
    validatePolymarketWalletBinding({
      walletAddress: `0x${VERIFIED_EVM_ADDRESS.slice(2).toUpperCase()}`,
      phantom,
    }),
    {
      ok: true,
      walletAddress: VERIFIED_EVM_ADDRESS,
    },
  )

  const mismatch = validatePolymarketWalletBinding({
    walletAddress: OTHER_EVM_ADDRESS,
    phantom,
  })
  assert.equal(mismatch.ok, false)
  if (!mismatch.ok) {
    assert.equal(mismatch.code, "POLYMARKET_WALLET_MISMATCH")
    assert.equal(mismatch.status, 409)
  }

  const missingVerifiedEvm = validatePolymarketWalletBinding({
    walletAddress: VERIFIED_EVM_ADDRESS,
    phantom: buildVerifiedPhantom({ evmAddress: "" }),
  })
  assert.equal(missingVerifiedEvm.ok, false)
  if (!missingVerifiedEvm.ok) {
    assert.equal(missingVerifiedEvm.code, "POLYMARKET_PHANTOM_EVM_REQUIRED")
    assert.equal(missingVerifiedEvm.status, 409)
  }
})
