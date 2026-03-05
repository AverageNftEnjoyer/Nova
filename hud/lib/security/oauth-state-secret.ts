import "server-only"

import { createHash } from "node:crypto"

const DEV_FALLBACK_OAUTH_STATE_SECRET = createHash("sha256")
  .update(`nova-dev-oauth-state:${process.cwd()}`)
  .digest("hex")

export function getOAuthStateSecret(): string {
  const configured = String(process.env.NOVA_ENCRYPTION_KEY || "").trim()
  if (configured) return configured
  if (process.env.NODE_ENV === "production") {
    throw new Error("OAuth state signing is not configured.")
  }
  return DEV_FALLBACK_OAUTH_STATE_SECRET
}
