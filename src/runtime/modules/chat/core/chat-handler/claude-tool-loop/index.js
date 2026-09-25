import {
  CLAUDE_CHAT_MAX_TOKENS,
  TOOL_LOOP_MAX_DURATION_MS,
  TOOL_LOOP_MAX_STEPS,
  TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS,
} from "../../../../../core/constants/index.js";
import { recordToolRunSafe } from "../../../../../../session/sqlite-store/index.js";
import { assertTaskToolAllowed } from "../task-tool-policy/index.js";
import { addLlmUsage, emptyLlmUsage, normalizeAnthropicUsage } from "../../../../../../providers/usage/index.js";
import { resolveLlmUsageRecorder } from "../llm-usage-recorder/index.js";
import { estimateLoopRequestTokens, trimClaudeLoopToolResults } from "../loop-context-trim/index.js";
import { withServerToolContext } from "../integration-tool-context/index.js";
import { consumeHudOpTokenForSensitiveAction } from "../../../../infrastructure/hud-gateway/index.js";

// Gmail actions that send content need a one-time HUD confirmation token in chat (same set and rule as the
// OpenAI loop, tool-loop-runner). Agent tasks (permissionMode set) are governed by the task tool policy instead.
const GMAIL_CONFIRM_REQUIRED_ACTIONS = new Set(["gmail_forward_message", "gmail_reply_draft"]);
const GMAIL_CONFIRM_BLOCKED_MESSAGE =
  "I need an explicit confirmation action before sending Gmail content. Please confirm and retry.";

function claudeBase(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Copy of `messages` with a prompt-cache breakpoint on the last content block, so the next step of the loop
// reads everything up to here from cache instead of paying for it again. The stored loop messages stay clean.
export function withLatestMessageCacheBreakpoint(messages) {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (typeof last.content === "string" && !last.content.trim()) return messages; // empty text blocks are rejected
  const blocks = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
  if (blocks.length === 0) return messages;
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } };
  return [...messages.slice(0, -1), { ...last, content: blocks }];
}

async function createMessage({ runtime, model, system, messages, tools, signal }) {
  const response = await fetch(`${claudeBase(runtime.baseURL)}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": runtime.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: CLAUDE_CHAT_MAX_TOKENS,
      system,
      messages,
      tools,
    }),
    signal,
    redirect: "error",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Keep the HTTP status on the error: model routing retries a refused economy model (404) on the selected model.
    const error = new Error(String(payload?.error?.message || `Claude request failed (${response.status})`));
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function runClaudeToolLoop({
  activeChatRuntime,
  selectedChatModel,
  systemPrompt,
  historyMessages,
  text,
  availableTools,
  // The tools offered to the model (execute-chat-request scopes them by connected integrations). Tool calls still
  // execute against availableTools. Defaults to availableTools.
  modelTools,
  runtimeTools,
  userContextId,
  conversationId,
  observedToolCalls,
  toolExecutions,
  abortSignal,
  permissionMode,
  approvedTools,
  workspaceDir,
  executionFenceCheck,
  consumeTaskApproval,
  reserveTaskEffect,
  usageRecorder,
  // One-time HUD confirmation token of this turn (chat only); required for GMAIL_CONFIRM_REQUIRED_ACTIONS.
  hudOpToken,
  // Agent-task budget controller (agent-tasks/budget), or undefined. When set it is asked before every model call
  // and may switch to the economy model, trim earlier tool results, or throw AgentTaskBudgetExhaustedError.
  taskBudget,
}) {
  const llmUsageRecorder = resolveLlmUsageRecorder(usageRecorder, {
    userContextId,
    conversationId,
    provider: activeChatRuntime?.provider || "claude",
  });
  const offeredTools = Array.isArray(modelTools) ? modelTools : availableTools;
  const toolDefinitions = offeredTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema:
      tool.input_schema && typeof tool.input_schema === "object"
        ? tool.input_schema
        : { type: "object", properties: {} },
  }));
  const messages = [
    ...historyMessages.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    })),
    { role: "user", content: text },
  ];
  const startedAt = Date.now();
  let loopUsage = emptyLlmUsage();
  // The model of the next call; only a task budget changes it (to the provider's economy model).
  let currentModel = selectedChatModel;

  for (let step = 0; step < Math.max(1, Number(TOOL_LOOP_MAX_STEPS || 1)); step += 1) {
    if (abortSignal?.aborted) throw abortSignal.reason || new Error("Agent task aborted.");
    if (Date.now() - startedAt > Number(TOOL_LOOP_MAX_DURATION_MS || 0)) {
      throw new Error("Claude agent tool loop exceeded its duration budget.");
    }

    if (taskBudget) {
      const decision = taskBudget.beforeModelCall({
        provider: activeChatRuntime?.provider || "claude",
        model: currentModel,
        estimateInputTokens: () => estimateLoopRequestTokens(systemPrompt, messages, toolDefinitions),
      });
      if (decision.trimContext) trimClaudeLoopToolResults(messages);
      currentModel = decision.model;
    }

    const response = await createMessage({
      runtime: activeChatRuntime,
      model: currentModel,
      system: systemPrompt,
      // From the second call on, the loop is resending earlier steps: cache them. The first call is often the
      // only one (no tool needed), so a cache write there would usually be wasted.
      messages: step > 0 ? withLatestMessageCacheBreakpoint(messages) : messages,
      tools: toolDefinitions,
      signal: abortSignal,
    });
    // Anthropic input_tokens excludes cache reads/writes; the normalised inputTokens is the total input.
    loopUsage = addLlmUsage(
      loopUsage,
      llmUsageRecorder.record({ model: currentModel, usage: normalizeAnthropicUsage(response?.usage) }),
    );
    const blocks = Array.isArray(response?.content) ? response.content : [];
    const toolUses = blocks.filter((block) => block?.type === "tool_use");
    const textReply = blocks
      .filter((block) => block?.type === "text")
      .map((block) => String(block?.text || ""))
      .join("\n")
      .trim();

    if (toolUses.length === 0) {
      if (!textReply) throw new Error("Claude returned no final task result.");
      return {
        reply: textReply,
        promptTokens: loopUsage.inputTokens,
        completionTokens: loopUsage.outputTokens,
        cachedInputTokens: loopUsage.cachedInputTokens,
        cacheWriteInputTokens: loopUsage.cacheWriteInputTokens,
        modelUsed: currentModel,
      };
    }

    messages.push({ role: "assistant", content: blocks });
    const toolResults = [];
    for (const toolUse of toolUses) {
      if (abortSignal?.aborted) throw abortSignal.reason || new Error("Agent task aborted.");
      const toolName = String(toolUse?.name || "").trim();
      if (toolName) observedToolCalls.push(toolName);
      const startedToolAt = Date.now();
      // gmail_* / coinbase_*: the turn's own user and conversation, never the model's (same as the OpenAI loop).
      // A new object: the model's tool_use block stays as sent, since it is resent as history.
      let toolInput = withServerToolContext(toolName, toolUse?.input, { userContextId, conversationId });
      if (GMAIL_CONFIRM_REQUIRED_ACTIONS.has(toolName) && !permissionMode) {
        // The server decides that confirmation is required; the model cannot opt out or confirm on its own.
        toolInput = { ...toolInput, requireExplicitUserConfirm: true };
        const confirmState = consumeHudOpTokenForSensitiveAction({
          userContextId,
          opToken: hudOpToken,
          conversationId,
          action: toolName,
        });
        if (!confirmState.ok) {
          const blockedReason = `sensitive_action_blocked:${confirmState.reason}`;
          recordToolRunSafe(userContextId, {
            threadId: conversationId,
            toolName,
            input: toolInput,
            output: { blocked: blockedReason },
            status: "blocked",
            latencyMs: 0,
          });
          toolExecutions.push({
            name: toolName,
            status: "blocked",
            durationMs: 0,
            error: blockedReason,
            resultPreview: "",
          });
          // Same outcome as the OpenAI loop's forcedReply: the turn ends with the confirmation request and no
          // further tool call of this response runs.
          return {
            reply: GMAIL_CONFIRM_BLOCKED_MESSAGE,
            promptTokens: loopUsage.inputTokens,
            completionTokens: loopUsage.outputTokens,
            cachedInputTokens: loopUsage.cachedInputTokens,
            cacheWriteInputTokens: loopUsage.cacheWriteInputTokens,
            modelUsed: currentModel,
          };
        }
      }
      try {
        const taskPolicy = permissionMode
          ? {
              ...assertTaskToolAllowed(
                permissionMode,
                toolName,
                availableTools,
                approvedTools,
                executionFenceCheck,
                toolInput,
                consumeTaskApproval,
                reserveTaskEffect,
              ),
              abortSignal,
              workspaceDir,
            }
          : undefined;
        const result = await withTimeout(
          runtimeTools.executeToolUse(
            {
              id: String(toolUse?.id || ""),
              name: toolName,
              input: toolInput,
              type: "tool_use",
            },
            availableTools,
            taskPolicy,
          ),
          Math.max(1_000, Number(TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS || 7_000)),
          `Tool ${toolName || "unknown"}`,
        );
        const content = String(result?.content || "");
        toolExecutions.push({
          name: toolName || "unknown",
          status: result?.is_error ? "error" : "ok",
          durationMs: Date.now() - startedToolAt,
          resultPreview: content.slice(0, 500),
        });
        recordToolRunSafe(userContextId, {
          threadId: conversationId,
          toolName: toolName || "unknown",
          input: toolInput,
          output: content,
          status: result?.is_error ? "error" : "success",
          latencyMs: Date.now() - startedToolAt,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: String(toolUse?.id || ""),
          content,
          is_error: result?.is_error === true,
        });
      } catch (error) {
        if (
          error?.code === "AGENT_TASK_APPROVAL_REQUIRED"
          || error?.code === "AGENT_TASK_FENCE_REVOKED"
        ) throw error;
        const message = error instanceof Error ? error.message : String(error);
        toolExecutions.push({
          name: toolName || "unknown",
          status: "error",
          durationMs: Date.now() - startedToolAt,
          error: message,
          resultPreview: "",
        });
        recordToolRunSafe(userContextId, {
          threadId: conversationId,
          toolName: toolName || "unknown",
          input: toolInput,
          output: { error: message },
          status: "error",
          latencyMs: Date.now() - startedToolAt,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: String(toolUse?.id || ""),
          content: `Tool execution failed: ${message}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(`Claude agent tool loop exceeded ${TOOL_LOOP_MAX_STEPS} steps.`);
}
