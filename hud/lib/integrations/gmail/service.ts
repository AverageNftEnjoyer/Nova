import { buildGmailOAuthUrl as buildOAuthUrl, parseGmailOAuthState as parseOAuthState } from "./auth.ts"
import { listRecentGmailMessages as listMessages } from "./messages.ts"
import { sendGmailMessage as sendMessage } from "./send.ts"
import { disconnectGmail as disconnectTokens, exchangeCodeForGmailTokens, getGmailClientConfig, getValidGmailAccessToken } from "./tokens.ts"
import type { GmailMessageSummary, GmailScope, GmailSendMessageInput, GmailSendMessageResult } from "./types.ts"

export async function buildGmailOAuthUrl(returnTo: string, scope?: GmailScope): Promise<string> {
  const config = await getGmailClientConfig(scope)
  const userId = String(scope?.userId || scope?.user?.id || "").trim()
  return buildOAuthUrl({ returnTo, userId, config })
}

export const parseGmailOAuthState = parseOAuthState

export { exchangeCodeForGmailTokens, getValidGmailAccessToken }

export async function disconnectGmail(accountId?: string, scope?: GmailScope): Promise<void> {
  return disconnectTokens(accountId, scope)
}

export async function listRecentGmailMessages(
  maxResults = 10,
  accountId?: string,
  scope?: GmailScope,
): Promise<GmailMessageSummary[]> {
  return listMessages(maxResults, accountId, scope)
}

export async function sendGmailMessage(input: GmailSendMessageInput): Promise<GmailSendMessageResult> {
  return sendMessage(input)
}
