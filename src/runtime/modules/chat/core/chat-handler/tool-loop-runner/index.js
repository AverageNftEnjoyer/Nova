import {
  TOOL_LOOP_MAX_STEPS,
  TOOL_LOOP_MAX_DURATION_MS,
  TOOL_LOOP_REQUEST_TIMEOUT_MS,
  TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS,
  TOOL_LOOP_RECOVERY_TIMEOUT_MS,
  TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP,
  TOOL_LOOP_MAX_PARALLEL_TOOL_CALLS_PER_STEP,
} from "../../../../../core/constants/index.js";
import { consumeHudOpTokenForSensitiveAction, broadcastThinkingStatus, broadcastAssistantStreamDelta } from "../../../../infrastructure/hud-gateway/index.js";
import { describeUnknownError, extractOpenAIChatText, withTimeout } from "../../../../llm/providers/index.js";
import { detectSuspiciousPatterns, wrapWebContent } from "../../../../context/external-content/index.js";
import { buildWebSearchReadableReply } from "../../../routing/intent-router/index.js";
import { summarizeToolResultPreview } from "../../chat-utils/index.js";
import { createToolLoopBudget, capToolCallsPerStep, isLikelyTimeoutError } from "../../tool-loop-guardrails/index.js";
import { resolveGmailToolErrorReply } from "../prompt-recovery/index.js";
import { recordToolRunSafe } from "../../../../../../session/sqlite-store/index.js";
import { assertTaskToolAllowed } from "../task-tool-policy/index.js";
import { addLlmUsage, emptyLlmUsage, normalizeOpenAiCompatibleUsage } from "../../../../../../providers/usage/index.js";
import { resolveLlmUsageRecorder } from "../llm-usage-recorder/index.js";

const GMAIL_CONFIRM_REQUIRED_ACTIONS = new Set(["gmail_forward_message", "gmail_reply_draft"]);

function chunkToolCalls(toolCalls, chunkSize) {
  const chunks = [];
  for (let idx = 0; idx < toolCalls.length; idx += chunkSize) {
    chunks.push(toolCalls.slice(idx, idx + chunkSize));
  }
  return chunks;
}

function resolveToolThinkingStatus(normalizedToolName) {
  if (normalizedToolName === "web_search") return "Searching web";
  if (normalizedToolName === "web_fetch") return "Reviewing sources";
  if (normalizedToolName.startsWith("coinbase_")) return "Querying Coinbase";
  if (normalizedToolName.startsWith("gmail_")) return "Checking Gmail";
  return "Running tools";
}

export async function runToolLoop({
  activeOpenAiCompatibleClient,
  modelUsed,
  messages,
  openAiToolDefs,
  openAiMaxCompletionTokens,
  openAiRequestTuningForModel,
  runtimeTools,
  toolRuntime,
  availableTools,
  assistantStreamId,
  source,
  conversationId,
  userContextId,
  hudOpToken,
  sessionKey,
  text,
  latencyTelemetry,
  observedToolCalls,
  toolExecutions,
  retries,
  markRecovery,
  abortSignal,
  permissionMode,
  approvedTools,
  workspaceDir,
  executionFenceCheck,
  consumeTaskApproval,
  reserveTaskEffect,
  provider = "",
  usageRecorder,
}) {
  // One ledger row per model call (every step and the recovery call); `provider` is the active runtime's
  // provider, since this OpenAI-compatible client is shared by openai / grok / gemini.
  const llmUsageRecorder = resolveLlmUsageRecorder(usageRecorder, { userContextId, conversationId, provider });
  const loopMessages = [...messages];
  const toolOutputsForRecovery = [];
  let forcedToolErrorReply = "";
  let reply = "";
  let loopUsage = emptyLlmUsage();

  const toolLoopBudget = createToolLoopBudget({
    maxDurationMs: Math.max(5000, Number(TOOL_LOOP_MAX_DURATION_MS || 0)),
    minTimeoutMs: 1000,
  });
  const toolLoopGuardrails = {
    maxDurationMs: Math.max(5000, Number(TOOL_LOOP_MAX_DURATION_MS || 0)),
    requestTimeoutMs: Math.max(1000, Number(TOOL_LOOP_REQUEST_TIMEOUT_MS || 0)),
    toolExecTimeoutMs: Math.max(1000, Number(TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS || 0)),
    recoveryTimeoutMs: Math.max(1000, Number(TOOL_LOOP_RECOVERY_TIMEOUT_MS || 0)),
    maxToolCallsPerStep: Math.max(1, Number(TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP || 1)),
    budgetExhausted: false,
    stepTimeouts: 0,
    toolExecutionTimeouts: 0,
    recoveryBudgetExhausted: false,
    cappedToolCalls: 0,
  };

  for (let step = 0; step < Math.max(1, TOOL_LOOP_MAX_STEPS); step += 1) {
    if (abortSignal?.aborted) throw abortSignal.reason || new Error("Agent task aborted.");
    if (toolLoopBudget.isExhausted()) {
      toolLoopGuardrails.budgetExhausted = true;
      latencyTelemetry.incrementCounter("tool_loop_budget_exhausted");
      forcedToolErrorReply =
        "I hit the tool execution time budget before finalizing the response. Please retry with a narrower request.";
      break;
    }
    broadcastThinkingStatus("Reasoning", userContextId);
    let completion = null;
    const stepTimeoutMs = toolLoopBudget.resolveTimeoutMs(TOOL_LOOP_REQUEST_TIMEOUT_MS, 3000);
    if (stepTimeoutMs <= 0) {
      toolLoopGuardrails.budgetExhausted = true;
      latencyTelemetry.incrementCounter("tool_loop_budget_exhausted");
      forcedToolErrorReply =
        "I hit the tool execution time budget before finalizing the response. Please retry with a narrower request.";
      break;
    }
    try {
      completion = await withTimeout(
        activeOpenAiCompatibleClient.chat.completions.create(
          {
            model: modelUsed,
            messages: loopMessages,
            max_completion_tokens: openAiMaxCompletionTokens,
            ...openAiRequestTuningForModel(modelUsed),
            tools: openAiToolDefs,
            tool_choice: "auto",
          },
          abortSignal ? { signal: abortSignal } : undefined,
        ),
        stepTimeoutMs,
        `Tool loop model ${modelUsed}`,
      );
    } catch (err) {
      if (isLikelyTimeoutError(err)) {
        toolLoopGuardrails.stepTimeouts += 1;
        latencyTelemetry.incrementCounter("tool_loop_step_timeouts");
      }
      throw err;
    }

    loopUsage = addLlmUsage(
      loopUsage,
      llmUsageRecorder.record({ model: modelUsed, usage: normalizeOpenAiCompatibleUsage(completion?.usage) }),
    );

    const choice = completion?.choices?.[0]?.message || {};
    const assistantText = extractOpenAIChatText(completion);
    const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];

    if (toolCalls.length === 0) {
      reply = assistantText.trim();
      break;
    }

    const toolCallCap = capToolCallsPerStep(toolCalls, TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP);
    const cappedToolCalls = toolCallCap.capped;
    if (toolCallCap.wasCapped) {
      toolLoopGuardrails.cappedToolCalls += toolCallCap.requestedCount - toolCallCap.cappedCount;
      latencyTelemetry.incrementCounter("tool_loop_tool_call_caps");
      console.warn(
        `[ToolLoop] Capped tool calls for step ${step + 1}: requested=${toolCalls.length} cap=${cappedToolCalls.length}`,
      );
      toolOutputsForRecovery.push({
        name: "tool_loop_guardrail",
        content: `Tool call count capped at ${cappedToolCalls.length} for this step.`,
      });
    }

    loopMessages.push({ role: "assistant", content: assistantText || "", tool_calls: cappedToolCalls });

    const requiresSequentialToolExecution = cappedToolCalls.some((toolCall) => {
      const normalizedToolName = String(toolCall?.function?.name || "").trim().toLowerCase();
      return GMAIL_CONFIRM_REQUIRED_ACTIONS.has(normalizedToolName);
    });
    const maxParallelToolCallsPerStep = Math.max(
      1,
      Math.min(
        Number(TOOL_LOOP_MAX_PARALLEL_TOOL_CALLS_PER_STEP || 1),
        cappedToolCalls.length,
      ),
    );
    const toolCallBatches = requiresSequentialToolExecution || maxParallelToolCallsPerStep === 1
      ? cappedToolCalls.map((toolCall) => [toolCall])
      : chunkToolCalls(cappedToolCalls, maxParallelToolCallsPerStep);

    const executeToolCall = async (toolCall) => {
      if (abortSignal?.aborted) throw abortSignal.reason || new Error("Agent task aborted.");
      if (toolLoopBudget.isExhausted()) {
        return {
          toolCallId: toolCall?.id,
          toolName: "",
          normalizedToolName: "",
          toolResultContent: "",
          budgetExhausted: true,
          stopRemainingToolCalls: true,
        };
      }
      const toolName = String(toolCall?.function?.name || toolCall?.id || "").trim();
      const normalizedToolName = toolName.toLowerCase();
      broadcastThinkingStatus(resolveToolThinkingStatus(normalizedToolName), userContextId);
      if (toolName) observedToolCalls.push(toolName);

      const toolUse = toolRuntime.toOpenAiToolUseBlock(toolCall);
      if (
        String(toolUse?.name || "").toLowerCase().startsWith("coinbase_")
        || String(toolUse?.name || "").toLowerCase().startsWith("gmail_")
      ) {
        toolUse.input = {
          ...(toolUse.input && typeof toolUse.input === "object" ? toolUse.input : {}),
          userContextId,
          conversationId,
        };
      }
      const taskPolicy = permissionMode
        ? {
            ...assertTaskToolAllowed(
              permissionMode,
              normalizedToolName,
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
      if (GMAIL_CONFIRM_REQUIRED_ACTIONS.has(normalizedToolName) && !permissionMode) {
        toolUse.input = {
          ...(toolUse.input && typeof toolUse.input === "object" ? toolUse.input : {}),
          requireExplicitUserConfirm: true,
        };
        const confirmState = consumeHudOpTokenForSensitiveAction({
          userContextId,
          opToken: hudOpToken,
          conversationId,
          action: normalizedToolName,
        });
        if (!confirmState.ok) {
          const safeBlockedMessage =
            "I need an explicit confirmation action before sending Gmail content. Please confirm and retry.";
          recordToolRunSafe(userContextId, {
            threadId: conversationId,
            toolName: normalizedToolName,
            input: toolUse.input,
            output: { blocked: `sensitive_action_blocked:${confirmState.reason}` },
            status: "blocked",
            latencyMs: 0,
          });
          toolExecutions.push({
            name: normalizedToolName,
            status: "blocked",
            durationMs: 0,
            error: `sensitive_action_blocked:${confirmState.reason}`,
            resultPreview: "",
          });
          return {
            toolCallId: toolCall.id,
            toolName,
            normalizedToolName,
            toolResultContent: JSON.stringify({
              ok: false,
              kind: normalizedToolName,
              errorCode: "CONFIRM_REQUIRED",
              safeMessage: safeBlockedMessage,
              guidance: "Use the UI confirmation and retry.",
              retryable: true,
            }),
            forcedReply: safeBlockedMessage,
            stopRemainingToolCalls: true,
          };
        }
      }

      let toolResult;
      const toolStartedAt = Date.now();
      try {
        const toolExecTimeoutMs = toolLoopBudget.resolveTimeoutMs(TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS, 1000);
        if (toolExecTimeoutMs <= 0) {
          throw new Error("tool loop execution budget exhausted");
        }
        toolResult = await withTimeout(
          runtimeTools.executeToolUse(toolUse, availableTools, taskPolicy),
          toolExecTimeoutMs,
          `Tool ${normalizedToolName || "unknown"}`,
        );
        toolExecutions.push({
          name: normalizedToolName || "unknown",
          status: "ok",
          durationMs: Date.now() - toolStartedAt,
          resultPreview: summarizeToolResultPreview(toolResult?.content || ""),
        });
        // Audit trail (redacted + capped, never throws): every tool invocation lands in tool_runs.
        recordToolRunSafe(userContextId, {
          threadId: conversationId,
          toolName: normalizedToolName || "unknown",
          input: toolUse.input,
          output: toolResult?.content,
          status: toolResult?.is_error ? "error" : "success",
          latencyMs: Date.now() - toolStartedAt,
        });
      } catch (toolErr) {
        if (
          toolErr?.code === "AGENT_TASK_APPROVAL_REQUIRED"
          || toolErr?.code === "AGENT_TASK_FENCE_REVOKED"
        ) throw toolErr;
        const errMsg = describeUnknownError(toolErr);
        if (isLikelyTimeoutError(toolErr)) {
          toolLoopGuardrails.toolExecutionTimeouts += 1;
          latencyTelemetry.incrementCounter("tool_loop_tool_exec_timeouts");
        }
        console.error(`[ToolLoop] Tool "${toolCall.function?.name ?? toolCall.id}" failed: ${errMsg}`);
        broadcastAssistantStreamDelta(
          assistantStreamId,
          `[Tool error: ${toolCall.function?.name ?? "unknown"} - ${errMsg}]`,
          source,
          undefined,
          conversationId,
          userContextId,
        );
        toolExecutions.push({
          name: normalizedToolName || "unknown",
          status: "error",
          durationMs: Date.now() - toolStartedAt,
          error: errMsg,
          resultPreview: "",
        });
        recordToolRunSafe(userContextId, {
          threadId: conversationId,
          toolName: normalizedToolName || "unknown",
          input: toolUse.input,
          output: { error: errMsg },
          status: isLikelyTimeoutError(toolErr) ? "timeout" : "error",
          latencyMs: Date.now() - toolStartedAt,
        });
        toolResult = { content: `Tool execution failed: ${errMsg}` };
      }

      return {
        toolCallId: toolCall.id,
        toolName,
        normalizedToolName,
        toolResultContent: String(toolResult?.content || ""),
        stopRemainingToolCalls: false,
      };
    };

    let haltRemainingToolCalls = false;
    for (const toolBatch of toolCallBatches) {
      if (toolLoopBudget.isExhausted()) {
        toolLoopGuardrails.budgetExhausted = true;
        latencyTelemetry.incrementCounter("tool_loop_budget_exhausted");
        forcedToolErrorReply =
          "I ran out of time while executing tools. Please retry with a narrower request.";
        break;
      }
      const batchResults = await Promise.all(toolBatch.map((toolCall) => executeToolCall(toolCall)));
      for (const result of batchResults) {
        if (result.budgetExhausted) {
          toolLoopGuardrails.budgetExhausted = true;
          latencyTelemetry.incrementCounter("tool_loop_budget_exhausted");
          forcedToolErrorReply =
            "I ran out of time while executing tools. Please retry with a narrower request.";
          haltRemainingToolCalls = true;
          break;
        }

        const content = String(result.toolResultContent || "");
        const normalizedName = String(result.normalizedToolName || "").toLowerCase();
        if (content.trim()) {
          toolOutputsForRecovery.push({ name: normalizedName, content });
          if (normalizedName === "web_search" && /^web_search error:/i.test(content)) {
            if (/missing brave api key/i.test(content)) {
              forcedToolErrorReply =
                "Live web search is unavailable because the Brave API key is missing. Add Brave in Integrations and retry.";
            } else if (/rate limited/i.test(content)) {
              forcedToolErrorReply =
                "Live web search is currently rate-limited. Please retry in a moment.";
            } else {
              forcedToolErrorReply =
                `Live web search failed: ${content.replace(/^web_search error:\s*/i, "").trim()}`;
            }
          }
          if (normalizedName.startsWith("gmail_")) {
            const gmailToolErrorReply = resolveGmailToolErrorReply(content);
            if (gmailToolErrorReply) {
              forcedToolErrorReply = gmailToolErrorReply;
            }
          }
        }

        let toolMessageContent = content;
        if (normalizedName === "web_search" || normalizedName === "web_fetch") {
          const suspiciousPatterns = detectSuspiciousPatterns(content);
          if (suspiciousPatterns.length > 0) {
            console.warn(
              `[Security] suspicious ${normalizedName} tool output patterns=${suspiciousPatterns.length} session=${sessionKey}`,
            );
          }
          toolMessageContent = wrapWebContent(content, normalizedName === "web_fetch" ? "web_fetch" : "web_search");
        }
        loopMessages.push({
          role: "tool",
          tool_call_id: result.toolCallId,
          content: toolMessageContent,
        });

        if (result.forcedReply) {
          forcedToolErrorReply = result.forcedReply;
        }
        if (result.stopRemainingToolCalls) {
          haltRemainingToolCalls = true;
          break;
        }
      }
      if (haltRemainingToolCalls) break;
    }

    if (forcedToolErrorReply) {
      reply = forcedToolErrorReply;
      break;
    }
  }

  if (!reply || !reply.trim()) {
    broadcastThinkingStatus("Recovering final answer", userContextId);
    try {
      const recoveryTimeoutMs = toolLoopBudget.resolveTimeoutMs(TOOL_LOOP_RECOVERY_TIMEOUT_MS, 1000);
      if (recoveryTimeoutMs <= 0) {
        toolLoopGuardrails.recoveryBudgetExhausted = true;
        latencyTelemetry.incrementCounter("tool_loop_recovery_budget_exhausted");
        throw new Error("tool loop recovery budget exhausted");
      }
      const recovery = await withTimeout(
        activeOpenAiCompatibleClient.chat.completions.create(
          {
            model: modelUsed,
            messages: [
              ...loopMessages,
              {
                role: "user",
                content: "Provide the final answer to the user using the tool results above. Keep it concise and actionable.",
              },
            ],
            max_completion_tokens: openAiMaxCompletionTokens,
            ...openAiRequestTuningForModel(modelUsed),
          },
          abortSignal ? { signal: abortSignal } : undefined,
        ),
        recoveryTimeoutMs,
        `Tool loop recovery model ${modelUsed}`,
      );
      // The recovery call is real spend: count it in the loop's tokens and the ledger like any step.
      loopUsage = addLlmUsage(
        loopUsage,
        llmUsageRecorder.record({ model: modelUsed, usage: normalizeOpenAiCompatibleUsage(recovery?.usage) }),
      );
      reply = extractOpenAIChatText(recovery).trim();
    } catch (recoveryErr) {
      console.warn(`[ToolLoop] recovery completion failed: ${describeUnknownError(recoveryErr)}`);
    }
  }

  if (!reply || !reply.trim()) {
    const latestUsefulTool = [...toolOutputsForRecovery]
      .reverse()
      .find((entry) => {
        const content = String(entry?.content || "").trim();
        if (!content) return false;
        if (entry.name === "web_search" && /^web_search error/i.test(content)) return false;
        if (entry.name === "web_fetch" && /^web_fetch error/i.test(content)) return false;
        return true;
      });

    if (latestUsefulTool) {
      if (latestUsefulTool.name === "web_search") {
        const readable = buildWebSearchReadableReply(text, latestUsefulTool.content);
        reply = readable || `Live web results:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
      } else if (latestUsefulTool.name === "web_fetch") {
        reply = `I fetched the page content but the model did not finalize the answer. Here is the extracted content:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
      } else {
        reply = `I ran tools but the model returned no final text. Tool output:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
      }
    } else {
      const latestToolError = [...toolOutputsForRecovery]
        .reverse()
        .find((entry) => {
          const content = String(entry?.content || "").trim().toLowerCase();
          return content.startsWith("web_search error") || content.startsWith("web_fetch error");
        });
      if (latestToolError) {
        if (latestToolError.name === "web_search") {
          const detail = String(latestToolError.content || "")
            .replace(/^web_search error:\s*/i, "")
            .trim();
          reply = detail
            ? `I couldn't complete a live web lookup: ${detail}`
            : "I couldn't complete a live web lookup right now.";
        } else {
          const detail = String(latestToolError.content || "")
            .replace(/^web_fetch error:\s*/i, "")
            .trim();
          reply = detail
            ? `I couldn't fetch the web source: ${detail}`
            : "I couldn't fetch the web source right now.";
        }
      }
    }
  }

  if (!reply || !reply.trim()) {
    markRecovery("tool_loop_empty_reply_error", "empty_reply_after_tool_loop", reply);
    retries.push({
      stage: "tool_loop_empty_reply_error",
      fromModel: modelUsed,
      toModel: modelUsed,
      reason: "empty_reply",
    });
    throw new Error("Tool loop produced no final response.");
  }

  return {
    reply,
    promptTokens: loopUsage.inputTokens,
    completionTokens: loopUsage.outputTokens,
    cachedInputTokens: loopUsage.cachedInputTokens,
    cacheWriteInputTokens: loopUsage.cacheWriteInputTokens,
    modelUsed,
    toolLoopGuardrails,
  };
}
