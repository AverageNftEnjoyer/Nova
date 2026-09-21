import "server-only"

import { NextResponse } from "next/server"
import { SecretsUnavailableError } from "@/lib/security/encryption"

/**
 * Clean 503 for a save that needed the encryption key but could not get it. The body is a fixed message: it never
 * echoes the request, the field names or the underlying error text.
 */
export function secretsUnavailableResponse(error: unknown): NextResponse | null {
  if (!(error instanceof SecretsUnavailableError)) return null
  return NextResponse.json(
    {
      error: "Secure key storage is unavailable, so nothing was saved. Restart Nova, and make sure you are signed in to the same Windows account that created your keys.",
      code: "SECRETS_UNAVAILABLE",
    },
    { status: 503 },
  )
}
