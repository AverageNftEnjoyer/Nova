export interface GmailAccountForUi {
  id: string
  email: string
  scopes: string[]
  connectedAt: string
  active: boolean
  enabled: boolean
}

/**
 * Normalizes raw Gmail account data from the server for UI consumption.
 */
export function normalizeGmailAccountsForUi(
  raw: unknown,
  activeAccountId: string
): GmailAccountForUi[] {
  const active = String(activeAccountId || "").trim().toLowerCase()
  if (!Array.isArray(raw)) return []

  return raw
    .map((account) => {
      const id = String((account as { id?: string })?.id || "").trim().toLowerCase()
      const email = String((account as { email?: string })?.email || "").trim()
      if (!id || !email) return null

      const scopes = Array.isArray((account as { scopes?: string[] })?.scopes)
        ? (account as { scopes: string[] }).scopes.map((scope) => String(scope).trim()).filter(Boolean)
        : []

      return {
        id,
        email,
        scopes,
        connectedAt:
          typeof (account as { connectedAt?: string })?.connectedAt === "string"
            ? String((account as { connectedAt?: string }).connectedAt)
            : "",
        active: id === active,
        enabled:
          typeof (account as { enabled?: boolean })?.enabled === "boolean"
            ? Boolean((account as { enabled?: boolean }).enabled)
            : true,
      }
    })
    .filter((account): account is NonNullable<typeof account> => Boolean(account))
}
