// Server-side user / conversation context for integration-bound tool calls.
//
// `gmail_*` and `coinbase_*` tools act on one user's connected account, chosen by the `userContextId` in their
// input. The model is never trusted with that choice: both tool loops (OpenAI-compatible and Claude) overwrite
// `userContextId` / `conversationId` with the turn's own values before the tool runs, so a value the model omits,
// invents or copies from untrusted content (another user's id) never reaches the tool. The model-facing schemas do
// not list these fields at all (token-efficiency Stage 3 decision c1).
//
// The server values always win, even when they are empty: a turn without a user id sends an empty id, which the
// tools reject (BAD_INPUT) instead of falling back to a model-supplied one.

const SERVER_CONTEXT_TOOL_PREFIXES = ["coinbase_", "gmail_"];

export function isServerContextTool(toolName) {
  const normalized = String(toolName || "").trim().toLowerCase();
  return SERVER_CONTEXT_TOOL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * The input to execute for a tool call. For an integration-bound tool it is a new object with the server's
 * `userContextId` / `conversationId` (overriding any model value); other tools get their input unchanged.
 * Never mutates `input` (in the Claude loop it is the model's tool_use block, which is resent as history).
 */
export function withServerToolContext(toolName, input, { userContextId, conversationId }) {
  const base = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (!isServerContextTool(toolName)) return base;
  return { ...base, userContextId, conversationId };
}
