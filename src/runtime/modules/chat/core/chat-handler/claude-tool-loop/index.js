import {
  CLAUDE_CHAT_MAX_TOKENS,
  TOOL_LOOP_MAX_DURATION_MS,
  TOOL_LOOP_MAX_STEPS,
  TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS,
} from "../../../../../core/constants/index.js";
import { recordToolRunSafe } from "../../../../../../session/sqlite-store/index.js";
import { assertTaskToolAllowed } from "../task-tool-policy/index.js";

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
    throw new Error(String(payload?.error?.message || `Claude request failed (${response.status})`));
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
}) {
  const toolDefinitions = availableTools.map((tool) => ({
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
  let promptTokens = 0;
  let completionTokens = 0;

  for (let step = 0; step < Math.max(1, Number(TOOL_LOOP_MAX_STEPS || 1)); step += 1) {
    if (abortSignal?.aborted) throw abortSignal.reason || new Error("Agent task aborted.");
    if (Date.now() - startedAt > Number(TOOL_LOOP_MAX_DURATION_MS || 0)) {
      throw new Error("Claude agent tool loop exceeded its duration budget.");
    }

    const response = await createMessage({
      runtime: activeChatRuntime,
      model: selectedChatModel,
      system: systemPrompt,
      messages,
      tools: toolDefinitions,
      signal: abortSignal,
    });
    promptTokens += Number(response?.usage?.input_tokens || 0);
    completionTokens += Number(response?.usage?.output_tokens || 0);
    const blocks = Array.isArray(response?.content) ? response.content : [];
    const toolUses = blocks.filter((block) => block?.type === "tool_use");
    const textReply = blocks
      .filter((block) => block?.type === "text")
      .map((block) => String(block?.text || ""))
      .join("\n")
      .trim();

    if (toolUses.length === 0) {
      if (!textReply) throw new Error("Claude returned no final task result.");
      return { reply: textReply, promptTokens, completionTokens, modelUsed: selectedChatModel };
    }

    messages.push({ role: "assistant", content: blocks });
    const toolResults = [];
    for (const toolUse of toolUses) {
      if (abortSignal?.aborted) throw abortSignal.reason || new Error("Agent task aborted.");
      const toolName = String(toolUse?.name || "").trim();
      if (toolName) observedToolCalls.push(toolName);
      const startedToolAt = Date.now();
      try {
        const taskPolicy = permissionMode
          ? {
              ...assertTaskToolAllowed(
                permissionMode,
                toolName,
                availableTools,
                approvedTools,
                executionFenceCheck,
                toolUse?.input || {},
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
              input: toolUse?.input && typeof toolUse.input === "object" ? toolUse.input : {},
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
          input: toolUse?.input || {},
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
          input: toolUse?.input || {},
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
