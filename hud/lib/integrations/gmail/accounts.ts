import type { GmailIntegrationConfig } from "../server-store"
import { gmailError } from "./errors"

function pickActiveAccount(accounts: GmailIntegrationConfig["accounts"], preferredId: string): GmailIntegrationConfig["accounts"][number] | null {
  const enabledAccounts = accounts.filter((account) => account.enabled)
  return enabledAccounts.find((account) => account.id === preferredId)
    || enabledAccounts[0]
    || accounts.find((account) => account.id === preferredId)
    || accounts[0]
    || null
}

function withSelectedAccount(base: GmailIntegrationConfig, accounts: GmailIntegrationConfig["accounts"], preferredId = ""): GmailIntegrationConfig {
  const selected = pickActiveAccount(accounts, preferredId)
  const connected = accounts.some((account) => account.enabled)
  return {
    ...base,
    connected,
    accounts,
    activeAccountId: selected?.id || "",
    email: selected?.email || "",
    scopes: selected?.scopes || [],
    accessTokenEnc: selected?.accessTokenEnc || "",
    refreshTokenEnc: selected?.refreshTokenEnc || "",
    tokenExpiry: selected?.tokenExpiry || 0,
  }
}

export function deriveGmailAfterDisconnect(
  gmail: GmailIntegrationConfig,
  accountId?: string,
): GmailIntegrationConfig {
  const targetId = String(accountId || "").trim().toLowerCase()
  const nextAccounts = targetId ? gmail.accounts.filter((account) => account.id !== targetId) : []
  return withSelectedAccount(gmail, nextAccounts, gmail.activeAccountId)
}

export function deriveGmailAfterSetPrimary(
  gmail: GmailIntegrationConfig,
  accountId: string,
): GmailIntegrationConfig {
  const targetId = String(accountId || "").trim().toLowerCase()
  const target = gmail.accounts.find((account) => account.id === targetId)
  if (!target) throw gmailError("gmail.account_not_found", "Account not found.", { status: 404 })
  if (!target.enabled) throw gmailError("gmail.invalid_request", "Only enabled accounts can be primary.", { status: 400 })
  return withSelectedAccount(gmail, gmail.accounts, targetId)
}

export function deriveGmailAfterSetEnabled(
  gmail: GmailIntegrationConfig,
  accountId: string,
  enabled: boolean,
): GmailIntegrationConfig {
  const targetId = String(accountId || "").trim().toLowerCase()
  const exists = gmail.accounts.some((account) => account.id === targetId)
  if (!exists) throw gmailError("gmail.account_not_found", "Account not found.", { status: 404 })
  const nextAccounts = gmail.accounts.map((account) =>
    account.id === targetId
      ? { ...account, enabled }
      : account,
  )
  return withSelectedAccount(gmail, nextAccounts, gmail.activeAccountId)
}

export function deriveGmailAfterTokenRefresh(
  gmail: GmailIntegrationConfig,
  accountId: string,
  accessTokenEnc: string,
  tokenExpiry: number,
): GmailIntegrationConfig {
  const targetId = String(accountId || "").trim().toLowerCase()
  const nextAccounts = gmail.accounts.map((account) =>
    account.id === targetId
      ? { ...account, accessTokenEnc, tokenExpiry }
      : account,
  )
  return withSelectedAccount(gmail, nextAccounts, targetId)
}
