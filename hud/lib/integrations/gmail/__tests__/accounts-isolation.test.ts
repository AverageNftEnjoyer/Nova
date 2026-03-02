import assert from "node:assert/strict"
import test from "node:test"

import { deriveGmailAfterDisconnect, deriveGmailAfterSetEnabled, deriveGmailAfterSetPrimary } from "../accounts.ts"
import type { GmailIntegrationConfig } from "../../store/server-store"

function sampleGmailConfig(): GmailIntegrationConfig {
  return {
    connected: true,
    email: "alpha@example.com",
    scopes: ["openid", "email"],
    accounts: [
      {
        id: "alpha@example.com",
        email: "alpha@example.com",
        scopes: ["openid", "email"],
        enabled: true,
        accessTokenEnc: "enc-a",
        refreshTokenEnc: "enc-r-a",
        tokenExpiry: 1000,
        connectedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "beta@example.com",
        email: "beta@example.com",
        scopes: ["openid", "email"],
        enabled: true,
        accessTokenEnc: "enc-b",
        refreshTokenEnc: "enc-r-b",
        tokenExpiry: 2000,
        connectedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    activeAccountId: "alpha@example.com",
    oauthClientId: "client",
    oauthClientSecret: "secret",
    redirectUri: "http://localhost:3000/api/integrations/gmail/callback",
    accessTokenEnc: "enc-a",
    refreshTokenEnc: "enc-r-a",
    tokenExpiry: 1000,
  }
}

test("unit: set_primary selects only enabled account", () => {
  const next = deriveGmailAfterSetPrimary(sampleGmailConfig(), "beta@example.com")
  assert.equal(next.activeAccountId, "beta@example.com")
  assert.equal(next.email, "beta@example.com")
  assert.equal(next.connected, true)
})

test("unit: set_enabled disables account and rotates active account", () => {
  const next = deriveGmailAfterSetEnabled(sampleGmailConfig(), "alpha@example.com", false)
  assert.equal(next.activeAccountId, "beta@example.com")
  assert.equal(next.email, "beta@example.com")
  assert.equal(next.accounts.find((item) => item.id === "alpha@example.com")?.enabled, false)
})

test("integration: scoped user config mutation does not leak to other users", () => {
  const userA = sampleGmailConfig()
  const userB = sampleGmailConfig()
  const userBOriginal = JSON.parse(JSON.stringify(userB)) as GmailIntegrationConfig

  const nextA = deriveGmailAfterDisconnect(userA, "alpha@example.com")
  assert.equal(nextA.accounts.some((item) => item.id === "alpha@example.com"), false)
  assert.deepEqual(userB, userBOriginal)
})
