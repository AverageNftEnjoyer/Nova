import "server-only"

import { createHash } from "node:crypto"

import { deriveApplicationSecret } from "../../../src/security/secrets/index.js"

const DEV_FALLBACK_OAUTH_STATE_SECRET = createHash("sha256")
  .update(`nova-dev-oauth-state:${process.cwd()}`)
  .digest("hex")

/**
 * Secret used to HMAC OAuth CSRF state blobs.
 * Preference order:
 * 1. Explicit NOVA_OAUTH_STATE_SECRET / NOVA_GMAIL_OAUTH_STATE_SECRET
 * 2. Deterministic secret derived from the local DPAPI master key
 * 3. Dev-only cwd hash (never used in production)
 */
export function getOAuthStateSecret(): string {
  const configured = String(
    process.env.NOVA_OAUTH_STATE_SECRET ||
      process.env.NOVA_GMAIL_OAUTH_STATE_SECRET ||
      "",
  ).trim()
  if (configured) return configured

  try {
    return deriveApplicationSecret("nova/oauth-state/v1")
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      const message = error instanceof Error ? error.message : "OAuth state signing is unavailable."
      throw new Error(message)
    }
    return DEV_FALLBACK_OAUTH_STATE_SECRET
  }
}
