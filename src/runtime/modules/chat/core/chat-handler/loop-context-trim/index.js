// Budget-driven context trimming for the tool loops (token-efficiency Stage 4).
//
// When an agent task is about to go over its budget, the loop degrades ONCE: every earlier tool result in the
// loop's history is replaced by a short preview; the results of the most recent tool step stay in full (the model
// is about to act on them). This deliberately changes history the loop has already sent, so the next request
// misses the prompt cache once; from then on the shorter history is cached again and every later step is cheaper.
//
// Both helpers mutate the loop's own message array in place (replacing message / block objects, never editing
// objects that may be shared) and return how many tool results were shortened. Already-shortened results are skipped.

import { countApproxTokens } from "../../../../../core/context-prompt/index.js";
import { summarizeToolResultPreview } from "../../chat-utils/index.js";

const TRIMMED_PREFIX = "[Earlier tool result shortened to stay within this task's budget.";

function shortenedToolResult(content) {
  return `${TRIMMED_PREFIX} Preview: ${summarizeToolResultPreview(content)}]`;
}

function isTrimmed(content) {
  return typeof content === "string" && content.startsWith(TRIMMED_PREFIX);
}

/** Text of a tool result whose content is a string or an array of content blocks. */
function toolResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === "object" && typeof block.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "");
}

/**
 * OpenAI-compatible loop: shorten every `role: "tool"` message except the ones answering the latest assistant
 * tool-call step (the tool messages after the last assistant message with tool_calls).
 */
export function trimOpenAiLoopToolResults(messages) {
  if (!Array.isArray(messages)) return 0;
  let lastToolCallStep = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      lastToolCallStep = index;
      break;
    }
  }
  let trimmed = 0;
  // Tool messages after lastToolCallStep belong to the latest step; with no tool-call step there is nothing to keep.
  const end = lastToolCallStep >= 0 ? lastToolCallStep : messages.length;
  for (let index = 0; index < end; index += 1) {
    const message = messages[index];
    if (message?.role !== "tool" || isTrimmed(message.content)) continue;
    messages[index] = { ...message, content: shortenedToolResult(toolResultText(message.content)) };
    trimmed += 1;
  }
  return trimmed;
}

function hasToolResultBlocks(message) {
  return message?.role === "user"
    && Array.isArray(message.content)
    && message.content.some((block) => block?.type === "tool_result");
}

/**
 * Claude loop: shorten the `tool_result` blocks of every user message except the latest user message that carries
 * tool results. tool_use_id and is_error are kept, so the tool_use / tool_result pairing stays valid.
 */
export function trimClaudeLoopToolResults(messages) {
  if (!Array.isArray(messages)) return 0;
  let latestToolResults = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (hasToolResultBlocks(messages[index])) {
      latestToolResults = index;
      break;
    }
  }
  let trimmed = 0;
  for (let index = 0; index < messages.length; index += 1) {
    if (index === latestToolResults || !hasToolResultBlocks(messages[index])) continue;
    const message = messages[index];
    let changed = false;
    const content = message.content.map((block) => {
      if (block?.type !== "tool_result" || isTrimmed(block.content)) return block;
      changed = true;
      trimmed += 1;
      return { ...block, content: shortenedToolResult(toolResultText(block.content)) };
    });
    if (changed) messages[index] = { ...message, content };
  }
  return trimmed;
}

/** Approximate input tokens of a request made of these parts (messages, tools, system...), for budget projection. */
export function estimateLoopRequestTokens(...parts) {
  let total = 0;
  for (const part of parts) {
    if (part === undefined || part === null) continue;
    total += countApproxTokens(typeof part === "string" ? part : JSON.stringify(part));
  }
  return total;
}
