import "server-only"

export {
  buildGmailOAuthUrl,
  disconnectGmail,
  exchangeCodeForGmailTokens,
  getValidGmailAccessToken,
  listRecentGmailMessages,
  parseGmailOAuthState,
  sendGmailMessage,
} from "@/lib/integrations/gmail/service"

export type {
  GmailErrorCode,
  GmailMessageSummary,
  GmailScope,
  GmailSendMessageInput,
  GmailSendMessageResult,
} from "@/lib/integrations/gmail/types"
