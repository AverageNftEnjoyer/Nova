import assert from "node:assert/strict"
import test from "node:test"

import {
  buildDisconnectedPhantomAuthState,
  buildVerifiedPhantomAuthState,
  shouldInvalidatePhantomWalletBinding,
  validatePhantomChallengeState,
} from "../guards.ts"
import type { PhantomWalletAuthState } from "../types.ts"

function buildAuthState(): PhantomWalletAuthState {
  return {
    version: 3,
    currentChallenge: {
      challengeId: "challenge-1",
      walletAddress: "WalletA",
      walletLabel: "Wall...letA",
      message: "Nova Phantom Verification",
      nonce: "nonce-1",
      origin: "http://localhost:3000",
      domain: "localhost:3000",
      uri: "http://localhost:3000/integrations",
      statement: "Sign in to Nova",
      versionLabel: "1",
      chainId: "solana:mainnet",
      resources: ["http://localhost:3000/integrations#phantom"],
      issuedAt: "2026-03-06T15:00:00.000Z",
      expiresAt: "2026-03-06T15:05:00.000Z",
      accessTokenHash: "token-hash-a",
      version: 3,
    },
    lastVerifiedWalletAddress: "",
    lastVerifiedAt: "",
    lastDisconnectedAt: "",
    lastInvalidationReason: "",
    updatedAt: "2026-03-06T15:00:00.000Z",
  }
}

test("phantom guards reject replay/stale session attempts", () => {
  const authState = buildAuthState()
  const staleSession = validatePhantomChallengeState({
    authState,
    walletAddress: "WalletA",
    accessTokenHash: "wrong-hash",
    nowMs: Date.parse("2026-03-06T15:01:00.000Z"),
  })
  assert.equal(staleSession.ok, false)
  assert.equal(staleSession.code, "PHANTOM_SESSION_MISMATCH")

  const replayed = validatePhantomChallengeState({
    authState: {
      ...authState,
      version: 4,
    },
    walletAddress: "WalletA",
    accessTokenHash: "token-hash-a",
    nowMs: Date.parse("2026-03-06T15:01:00.000Z"),
  })
  assert.equal(replayed.ok, false)
  assert.equal(replayed.code, "PHANTOM_BINDING_VERSION_MISMATCH")
})

test("phantom guards expire nonce challenges and flag challenge clearing", () => {
  const result = validatePhantomChallengeState({
    authState: buildAuthState(),
    walletAddress: "WalletA",
    accessTokenHash: "token-hash-a",
    nowMs: Date.parse("2026-03-06T15:06:00.000Z"),
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, "PHANTOM_CHALLENGE_EXPIRED")
  assert.equal(result.clearChallenge, true)
  assert.equal(result.invalidationReason, "challenge_expired")
})

test("phantom disconnect invalidation clears challenge and increments version", () => {
  const next = buildDisconnectedPhantomAuthState(buildAuthState(), "2026-03-06T15:10:00.000Z", "user_disconnect")
  assert.equal(next.version, 4)
  assert.equal(next.currentChallenge, null)
  assert.equal(next.lastDisconnectedAt, "2026-03-06T15:10:00.000Z")
  assert.equal(next.lastInvalidationReason, "user_disconnect")
})

test("phantom verified state clears pending challenge and records verified wallet", () => {
  const next = buildVerifiedPhantomAuthState(buildAuthState(), "WalletA", "2026-03-06T15:02:00.000Z")
  assert.equal(next.version, 4)
  assert.equal(next.currentChallenge, null)
  assert.equal(next.lastVerifiedWalletAddress, "WalletA")
  assert.equal(next.lastVerifiedAt, "2026-03-06T15:02:00.000Z")
})

test("phantom wallet change invalidation only triggers for a different verified account", () => {
  assert.equal(shouldInvalidatePhantomWalletBinding("WalletA", "WalletB"), true)
  assert.equal(shouldInvalidatePhantomWalletBinding("WalletA", "WalletA"), false)
  assert.equal(shouldInvalidatePhantomWalletBinding("", "WalletB"), false)
})
