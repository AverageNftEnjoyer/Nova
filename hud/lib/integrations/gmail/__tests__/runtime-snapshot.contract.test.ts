import assert from "node:assert/strict"
import test from "node:test"

import { buildRuntimeSafeGmailSnapshot } from "../runtime-safe"
import type { GmailIntegrationConfig } from "../../server-store"

function buildGmailConfig(): GmailIntegrationConfig {
  return {
    connected: true,
    email: "alpha@example.com",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
    accounts: [
      {
        id: "alpha@example.com",
        email: "alpha@example.com",
        scopes: ["openid", "email"],
        enabled: true,
        accessTokenEnc: "access-secret",
        refreshTokenEnc: "refresh-secret",
        tokenExpiry: Date.now() + 60_000,
        connectedAt: new Date().toISOString(),
      },
    ],
    activeAccountId: "alpha@example.com",
    oauthClientId: "",
    oauthClientSecret: "",
    redirectUri: "http://localhost:3000/api/integrations/gmail/callback",
    accessTokenEnc: "legacy-access-secret",
    refreshTokenEnc: "legacy-refresh-secret",
    tokenExpiry: Date.now() + 60_000,
  }
}

test("integration: runtime snapshot contract emits token-safe gmail metadata", () => {
  const snapshot = buildRuntimeSafeGmailSnapshot(buildGmailConfig())
  assert.equal(snapshot.connected, true)
  assert.equal(snapshot.activeAccountId, "alpha@example.com")
  assert.equal(snapshot.email, "alpha@example.com")
  assert.deepEqual(snapshot.scopes, ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"])
  assert.equal(Array.isArray(snapshot.accounts), true)
  assert.equal(snapshot.accounts[0]?.id, "alpha@example.com")
  assert.deepEqual(Object.keys(snapshot.accounts[0] || {}).sort(), ["email", "enabled", "id", "scopes"])
  const serialized = JSON.stringify(snapshot)
  assert.equal(serialized.includes("access-secret"), false)
  assert.equal(serialized.includes("refresh-secret"), false)
  assert.equal(serialized.includes("legacy-access-secret"), false)
  assert.equal(serialized.includes("legacy-refresh-secret"), false)
})

