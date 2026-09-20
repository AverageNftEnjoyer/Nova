"use client"

/**
 * Auth Fetch Bridge - Disabled in local-only mode
 * Previously injected Supabase auth tokens into API calls
 * Now a no-op since we're fully local without authentication
 */
export function AuthFetchBridge() {
  return null
}
