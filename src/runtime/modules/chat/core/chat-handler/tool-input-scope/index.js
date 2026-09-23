// Tool-input scoping shared by the OpenAI-compatible tool loop (tool-loop-runner) and the Claude tool loop.
//
// - Gmail and Coinbase tools act on one user's account. The runtime, not the model, decides whose: the model's
//   `userContextId` / `conversationId` are always overwritten with the current turn's values.
// - Sending Gmail content (forward, reply draft) in chat needs a HUD confirmation token. Outside agent tasks
//   (which have their own approval policy) the runtime sets `requireExplicitUserConfirm` itself and only after
//   consuming a valid HUD op token; without one the call is blocked.
import { consumeHudOpTokenForSensitiveAction } from "../../../../infrastructure/hud-gateway/index.js";

export const GMAIL_CONFIRM_REQUIRED_ACTIONS = new Set(["gmail_forward_message", "gmail_reply_draft"]);

const GMAIL_CONFIRM_BLOCKED_MESSAGE =
  "I need an explicit confirmation action before sending Gmail content. Please confirm and retry.";

export function isUserScopedToolName(toolName) {
  const normalized = String(toolName || "").trim().toLowerCase();
  return normalized.startsWith("coinbase_") || normalized.startsWith("gmail_");
}

/** The tool input with the turn's user and conversation injected for user-scoped tools; other tools unchanged. */
export function scopeToolInputToUser(toolName, input, { userContextId, conversationId }) {
  const base = input && typeof input === "object" ? input : {};
  if (!isUserScopedToolName(toolName)) return base;
  return { ...base, userContextId, conversationId };
}

/**
 * Gmail send-type actions outside agent tasks. Returns `{ input }` (possibly with `requireExplicitUserConfirm: true`)
 * when the call may run, or `{ input, blocked }` when the HUD confirmation token is missing or invalid.
 * `blocked.content` is the tool result to hand back to the model and `blocked.message` the user-facing reply.
 */
export function gateSensitiveGmailAction({ toolName, input, permissionMode, userContextId, conversationId, hudOpToken }) {
  const normalized = String(toolName || "").trim().toLowerCase();
  const base = input && typeof input === "object" ? input : {};
  if (!GMAIL_CONFIRM_REQUIRED_ACTIONS.has(normalized) || permissionMode) return { input: base, blocked: null };
  const scopedInput = { ...base, requireExplicitUserConfirm: true };
  const confirmState = consumeHudOpTokenForSensitiveAction({
    userContextId,
    opToken: hudOpToken,
    conversationId,
    action: normalized,
  });
  if (confirmState.ok) return { input: scopedInput, blocked: null };
  return {
    input: scopedInput,
    blocked: {
      reason: `sensitive_action_blocked:${confirmState.reason}`,
      message: GMAIL_CONFIRM_BLOCKED_MESSAGE,
      content: JSON.stringify({
        ok: false,
        kind: normalized,
        errorCode: "CONFIRM_REQUIRED",
        safeMessage: GMAIL_CONFIRM_BLOCKED_MESSAGE,
        guidance: "Use the UI confirmation and retry.",
        retryable: true,
      }),
    },
  };
}
