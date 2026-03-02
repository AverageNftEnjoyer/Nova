/**
 * Unit tests for GmailCalendar OAuth state signing / verification.
 * We exercise the module through its exported functions — no HTTP, no DB.
 */
import assert from "node:assert/strict"
import test from "node:test"

// Provide env vars before importing the module under test
process.env.NOVA_GMAIL_OAUTH_STATE_SECRET = "test-secret-abc123"
// NODE_ENV is read-only in strict TS — already "test" in node:test runner

import {
  buildGmailCalendarOAuthUrl,
  parseGmailCalendarOAuthState,
} from "../auth/index.ts"
import type { GmailClientConfig } from "../../gmail/types.ts"

const FAKE_CONFIG: GmailClientConfig = {
  clientId:     "fake-client-id.apps.googleusercontent.com",
  clientSecret: "fake-secret",
  redirectUri:  "http://localhost:3000/api/integrations/gmail-calendar/callback",
  appUrl:       "http://localhost:3000",
}

// ─── buildGmailCalendarOAuthUrl ───────────────────────────────────────────────

test("buildGmailCalendarOAuthUrl: returns Google OAuth URL", () => {
  const url = buildGmailCalendarOAuthUrl({
    returnTo: "/integrations",
    userId: "user-abc",
    config: FAKE_CONFIG,
    currentGmailScopes: [],
  })
  assert.ok(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth"), `URL was: ${url}`)
})

test("buildGmailCalendarOAuthUrl: includes calendar.events scope", () => {
  const url = buildGmailCalendarOAuthUrl({
    returnTo: "/integrations",
    userId: "user-abc",
    config: FAKE_CONFIG,
    currentGmailScopes: [],
  })
  assert.ok(
    url.includes("calendar.events"),
    `Expected calendar.events in URL scopes. Got: ${url}`,
  )
})

test("buildGmailCalendarOAuthUrl: includes openid + email base scopes", () => {
  const url = buildGmailCalendarOAuthUrl({
    returnTo: "/integrations",
    userId: "user-abc",
    config: FAKE_CONFIG,
    currentGmailScopes: [],
  })
  assert.ok(url.includes("openid"))
  assert.ok(url.includes("email"))
})

test("buildGmailCalendarOAuthUrl: deduplicates scopes from currentGmailScopes", () => {
  const url = buildGmailCalendarOAuthUrl({
    returnTo: "/integrations",
    userId: "user-abc",
    config: FAKE_CONFIG,
    currentGmailScopes: ["openid", "email"],
  })
  const parsed = new URL(url)
  const scopes = (parsed.searchParams.get("scope") ?? "").split(" ")
  const unique = new Set(scopes)
  assert.equal(scopes.length, unique.size, "Scopes should be deduplicated")
})

test("buildGmailCalendarOAuthUrl: throws on empty userId", () => {
  assert.throws(() => {
    buildGmailCalendarOAuthUrl({
      returnTo: "/integrations",
      userId: "",
      config: FAKE_CONFIG,
      currentGmailScopes: [],
    })
  })
})

test("buildGmailCalendarOAuthUrl: throws on empty clientId", () => {
  assert.throws(() => {
    buildGmailCalendarOAuthUrl({
      returnTo: "/integrations",
      userId: "user-abc",
      config: { ...FAKE_CONFIG, clientId: "" },
      currentGmailScopes: [],
    })
  })
})

test("buildGmailCalendarOAuthUrl: unsafe returnTo is sanitised to /integrations", () => {
  const url = buildGmailCalendarOAuthUrl({
    returnTo: "https://evil.com/steal",
    userId: "user-abc",
    config: FAKE_CONFIG,
    currentGmailScopes: [],
  })
  // The state payload should NOT contain the external URL
  assert.ok(!url.includes("evil.com"), "evil.com should not appear in URL")
})

// ─── parseGmailCalendarOAuthState round-trip ──────────────────────────────────

function extractState(oauthUrl: string): string {
  const parsed = new URL(oauthUrl)
  const state = parsed.searchParams.get("state")
  assert.ok(state, "state param should be present")
  return state!
}

test("parseGmailCalendarOAuthState: round-trips userId and returnTo", () => {
  const oauthUrl = buildGmailCalendarOAuthUrl({
    returnTo: "/integrations",
    userId: "user-roundtrip",
    config: FAKE_CONFIG,
    currentGmailScopes: [],
  })
  const state = extractState(oauthUrl)
  const result = parseGmailCalendarOAuthState(state)
  assert.ok(result, "should parse successfully")
  assert.equal(result!.userId, "user-roundtrip")
  assert.equal(result!.returnTo, "/integrations")
})

test("parseGmailCalendarOAuthState: rejects tampered state", () => {
  const oauthUrl = buildGmailCalendarOAuthUrl({
    returnTo: "/integrations",
    userId: "user-tamper",
    config: FAKE_CONFIG,
    currentGmailScopes: [],
  })
  const state = extractState(oauthUrl)
  // Flip one char in the body part
  const [body, sig] = state.split(".")
  const tampered = body.slice(0, -1) + (body.at(-1) === "a" ? "b" : "a") + "." + sig
  assert.equal(parseGmailCalendarOAuthState(tampered), null)
})

test("parseGmailCalendarOAuthState: rejects empty string", () => {
  assert.equal(parseGmailCalendarOAuthState(""), null)
})

test("parseGmailCalendarOAuthState: rejects state with wrong flow discriminator", async () => {
  const { createHmac } = await import("node:crypto")
  const body = Buffer.from(JSON.stringify({
    ts: Date.now(),
    nonce: "aabbcc",
    userId: "user-x",
    returnTo: "/integrations",
    flow: "gmail",           // ← wrong flow
  }), "utf8").toString("base64url")
  const sig = createHmac("sha256", "test-secret-abc123").update(body).digest("base64url")
  const state = `${body}.${sig}`
  assert.equal(parseGmailCalendarOAuthState(state), null)
})

test("parseGmailCalendarOAuthState: rejects expired state (>10 min old)", async () => {
  const { createHmac } = await import("node:crypto")
  const body = Buffer.from(JSON.stringify({
    ts: Date.now() - 11 * 60 * 1000,  // 11 minutes ago
    nonce: "aabbcc",
    userId: "user-expired",
    returnTo: "/integrations",
    flow: "gmail-calendar",
  }), "utf8").toString("base64url")
  const sig = createHmac("sha256", "test-secret-abc123").update(body).digest("base64url")
  const state = `${body}.${sig}`
  assert.equal(parseGmailCalendarOAuthState(state), null)
})
