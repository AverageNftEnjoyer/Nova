import type { GmailIntegrationConfig } from "../store/server-store"

export interface RuntimeSafeGmailSnapshot {
  connected: boolean
  activeAccountId: string
  email: string
  scopes: string[]
  accounts: Array<{
    id: string
    email: string
    enabled: boolean
    scopes: string[]
  }>
}

export function buildRuntimeSafeGmailSnapshot(gmail: GmailIntegrationConfig): RuntimeSafeGmailSnapshot {
  return {
    connected: Boolean(gmail.connected),
    activeAccountId: String(gmail.activeAccountId || "").trim(),
    email: String(gmail.email || "").trim(),
    scopes: Array.isArray(gmail.scopes)
      ? gmail.scopes.map((scope) => String(scope).trim()).filter(Boolean)
      : [],
    accounts: Array.isArray(gmail.accounts)
      ? gmail.accounts.map((account) => ({
          id: String(account.id || "").trim(),
          email: String(account.email || "").trim(),
          enabled: Boolean(account.enabled),
          scopes: Array.isArray(account.scopes)
            ? account.scopes.map((scope) => String(scope).trim()).filter(Boolean)
            : [],
        }))
      : [],
  }
}

