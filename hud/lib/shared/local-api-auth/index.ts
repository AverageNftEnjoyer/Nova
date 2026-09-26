// Nova is local-first: there are no accounts, sessions or sign-in page. An HTTP 401 from Nova's own API can
// only mean the runtime shared token did not match (hud/lib/security/runtime-auth), which a restart fixes.
// Integration-specific auth failures (an expired Spotify/Google/Coinbase token) carry their own server message
// and "reconnect in Integrations" handling instead; never navigate anywhere on a 401.

export const LOCAL_API_UNAUTHORIZED_MESSAGE =
  "Nova's local API rejected the request (runtime token mismatch). Restart Nova."

export class LocalApiUnauthorizedError extends Error {
  constructor() {
    super(LOCAL_API_UNAUTHORIZED_MESSAGE)
    this.name = "LocalApiUnauthorizedError"
  }
}

/** The shared 401 message when `error` is a LocalApiUnauthorizedError, otherwise `fallback`. */
export function localApiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof LocalApiUnauthorizedError ? error.message : fallback
}
