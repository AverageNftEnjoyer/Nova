import assert from "node:assert/strict"
import test from "node:test"

import { createPhantomAuthChallenge } from "../challenge.ts"

test("phantom challenge issuance binds nonce/message to user context, wallet, and session hash", () => {
  const challenge = createPhantomAuthChallenge({
    userContextId: "wallet-user-1",
    walletAddress: "WalletA",
    accessTokenHash: "token-hash-a",
    version: 2,
    origin: "http://localhost:3000/integrations",
    nowMs: Date.parse("2026-03-06T15:00:00.000Z"),
    ttlMs: 300_000,
  })

  assert.equal(challenge.walletAddress, "WalletA")
  assert.equal(challenge.accessTokenHash, "token-hash-a")
  assert.equal(challenge.version, 2)
  assert.equal(challenge.origin, "http://localhost:3000")
  assert.equal(challenge.domain, "localhost:3000")
  assert.equal(challenge.uri, "http://localhost:3000/integrations")
  assert.equal(challenge.versionLabel, "1")
  assert.equal(challenge.chainId, "solana:mainnet")
  assert.equal(challenge.issuedAt, "2026-03-06T15:00:00.000Z")
  assert.equal(challenge.expiresAt, "2026-03-06T15:05:00.000Z")
  assert.match(challenge.message, /^localhost:3000 wants you to sign in with your Solana account:/)
  assert.match(challenge.message, /URI: http:\/\/localhost:3000\/integrations/)
  assert.match(challenge.message, /Chain ID: solana:mainnet/)
  assert.match(challenge.message, /Request ID: nova-phantom-auth/)
  assert.ok(challenge.nonce.length > 10)
  assert.ok(challenge.challengeId.length > 10)
  assert.equal(challenge.resources.length, 2)
})
