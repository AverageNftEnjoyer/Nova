import {
  OPENAI_FALLBACK_MODEL,
  TOOL_LOOP_MAX_STEPS,
  TOOL_LOOP_MAX_DURATION_MS,
  TOOL_LOOP_REQUEST_TIMEOUT_MS,
  TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS,
  TOOL_LOOP_RECOVERY_TIMEOUT_MS,
  TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP,
} from "../../../../core/constants/index.js";
import { consumeHudOpTokenForSensitiveAction, broadcastThinkingStatus, broadcastAssistantStreamDelta } from "../../../../infrastructure/hud-gateway/index.js";
import { describeUnknownError, extractOpenAIChatText, withTimeout } from "../../../llm/providers.js";
import { detectSuspiciousPatterns, wrapWebContent } from "../../../context/external-content/index.js";
import { isWeatherRequestText } from "../../fast-path/weather-fast-path.js";
import { buildWebSearchReadableReply, buildWeatherWebSummary } from "../../routing/intent-router.js";
import { summarizeToolResultPreview } from "../chat-utils.js";
import { createToolLoopBudget, capToolCallsPerStep, isLikelyTimeoutError } from "../tool-loop-guardrails.js";
import { resolveGmailToolFallbackReply, buildConstraintSafeFallback } from "./prompt-fallbacks.js";

export async function runToolLoop({
  activeOpenAiCompatibleClient,
  modelUsed,
  primaryModel,
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
  outputConstraints,
  hasStrictOutputRequirements,
  markFallback,
}) {
  const loopMessages = [...messages];
  const toolOutputsForRecovery = [];
  let forcedToolFallbackReply = "";
  let usedFallback = false;
  let reply = "";
  let promptTokens = 0;
  let completionTokens = 0;

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
    if (toolLoopBudget.isExhausted()) {
      toolLoopGuardrails.budgetExhausted = true;
      latencyTelemetry.incrementCounter("tool_loop_budget_exhausted");
      forcedToolFallbackReply =
        "I hit the tool execution time budget before finalizing the response. Please retry with a narrower request.";
      break;
    }
    broadcastThinkingStatus("Reasoning", userContextId);
    let completion = null;
    const stepTimeoutMs = toolLoopBudget.resolveTimeoutMs(TOOL_LOOP_REQUEST_TIMEOUT_MS, 3000);
    if (stepTimeoutMs <= 0) {
      toolLoopGuardrails.budgetExhausted = true;
      latencyTelemetry.incrementCounter("tool_loop_budget_exhausted");
      forcedToolFallbackReply =
        "I hit the tool execution time budget before finalizing the response. Please retry with a narrower request.";
      break;
    }
    try {
      completion = await withTimeout(
        activeOpenAiCompatibleClient.chat.completions.create({
          model: modelUsed,
          messages: loopMessages,
          max_completion_tokens: openAiMaxCompletionTokens,
          ...openAiRequestTuningForModel(modelUsed),
          tools: openAiToolDefs,
          tool_choice: "auto",
        }),
        stepTimeoutMs,
        `Tool loop model ${modelUsed}`,
      );
    } catch (err) {
      if (!usedFallback && OPENAI_FALLBACK_MODEL) {
        usedFallback = true;
        modelUsed = OPENAI_FALLBACK_MODEL;
        retries.push({
          stage: "tool_loop_completion",
          fromModel: primaryModel,
          toModel: modelUsed,
          reason: "primary_failed",
        });
        console.warn(`[ToolLoop] Primary model failed; retrying with fallback model ${modelUsed}.`);
        completion = await withTimeout(
          activeOpenAiCompatibleClient.chat.completions.create({
            model: modelUsed,
            messages: loopMessages,
            max_completion_tokens: openAiMaxCompletionTokens,
            ...openAiRequestTuningForModel(modelUsed),
            tools: openAiToolDefs,
            tool_choice: "auto",
          }),
          toolLoopBudget.resolveTimeoutMs(TOOL_LOOP_REQUEST_TIMEOUT_MS, 3000),
          `Tool loop fallback model ${modelUsed}`,
        );
      } else {
        if (isLikelyTimeoutError(err)) {
          toolLoopGuardrails.stepTimeouts += 1;
          latencyTelemetry.incrementCounter("tool_loop_step_timeouts");
        }
        throw err;
      }
    }

    const usage = completion?.usage || {};
    promptTokens += Number(usage.prompt_tokens || 0);
    completionTokens += Number(usage.completion_tokens || 0);

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

    for (const toolCall of cappedToolCalls) {
      if (toolLoopBudget.isExhausted()) {
        toolLoopGuardrails.budgetExhausted = true;
        latencyTelemetry.incrementCounter("tool_loop_budget_exhausted");
        forcedToolFallbackReply =
          "I ran out of time while executing tools. Please retry with a narrower request.";
        break;
      }
      const toolName = String(toolCall?.function?.name || toolCall?.id || "").trim();
      const normalizedToolName = toolName.toLowerCase();
      if (normalizedToolName === "web_search") broadcastThinkingStatus("Searching web", userContextId);
      else if (normalizedToolName === "web_fetch") broadcastThinkingStatus("Reviewing sources", userContextId);
      else if (normalizedToolName.startsWith("coinbase_")) broadcastThinkingStatus("Querying Coinbase", userContextId);
      else if (normalizedToolName.startsWith("gmail_")) broadcastThinkingStatus("Checking Gmail", userContextId);
      else broadcastThinkingStatus("Running tools", userContextId);
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
      if (
        normalizedToolName === "gmail_forward_message"
        || normalizedToolName === "gmail_reply_draft"
      ) {
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
          forcedToolFallbackReply = safeBlockedMessage;
          toolExecutions.push({
            name: normalizedToolName,
            status: "blocked",
            durationMs: 0,
            error: `sensitive_action_blocked:${confirmState.reason}`,
            resultPreview: "",
          });
          loopMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              ok: false,
              kind: normalizedToolName,
              errorCode: "CONFIRM_REQUIRED",
              safeMessage: safeBlockedMessage,
              guidance: "Use the UI confirmation and retry.",
              retryable: true,
            }),
          });
          break;
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
          runtimeTools.executeToolUse(toolUse, availableTools),
          toolExecTimeoutMs,
          `Tool ${normalizedToolName || "unknown"}`,
        );
        toolExecutions.push({
          name: normalizedToolName || "unknown",
          status: "ok",
          durationMs: Date.now() - toolStartedAt,
          resultPreview: summarizeToolResultPreview(toolResult?.content || ""),
        });
      } catch (toolErr) {
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
        toolResult = { content: `Tool execution failed: ${errMsg}` };
      }
      loopMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: (() => {
          const content = String(toolResult?.content || "");
          const normalizedName = String(toolName || "").toLowerCase();
          if (content.trim()) {
            toolOutputsForRecovery.push({ name: normalizedName, content });
            if (normalizedName === "web_search" && /^web_search error:/i.test(content)) {
              if (/missing brave api key/i.test(content)) {
                forcedToolFallbackReply =
                  "Live web search is unavailable because the Brave API key is missing. Add Brave in Integrations and retry.";
              } else if (/rate limited/i.test(content)) {
                forcedToolFallbackReply =
                  "Live web search is currently rate-limited. Please retry in a moment.";
              } else {
                forcedToolFallbackReply =
                  `Live web search failed: ${content.replace(/^web_search error:\s*/i, "").trim()}`;
              }
            }
            if (normalizedName.startsWith("gmail_")) {
              const gmailFallback = resolveGmailToolFallbackReply(content);
              if (gmailFallback) {
                forcedToolFallbackReply = gmailFallback;
              }
            }
          }
          if (normalizedName !== "web_search" && normalizedName !== "web_fetch") {
            return content;
          }
          const suspiciousPatterns = detectSuspiciousPatterns(content);
          if (suspiciousPatterns.length > 0) {
            console.warn(
              `[Security] suspicious ${normalizedName} tool output patterns=${suspiciousPatterns.length} session=${sessionKey}`,
            );
          }
          return wrapWebContent(content, normalizedName === "web_fetch" ? "web_fetch" : "web_search");
        })(),
      });
    }

    if (forcedToolFallbackReply) {
      reply = forcedToolFallbackReply;
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
        activeOpenAiCompatibleClient.chat.completions.create({
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
        }),
        recoveryTimeoutMs,
        `Tool loop recovery model ${modelUsed}`,
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
        if (isWeatherRequestText(text)) {
          const weatherReadable = buildWeatherWebSummary(text, latestUsefulTool.content);
          reply = weatherReadable
            || "I checked live weather sources, but couldn't extract a reliable forecast summary yet. Please retry with city and state (for example: Pittsburgh, PA).";
        } else {
          const readable = buildWebSearchReadableReply(text, latestUsefulTool.content);
          reply = readable || `Live web results:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
        }
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
    const fallbackReply = buildConstraintSafeFallback(outputConstraints, text, {
      strict: hasStrictOutputRequirements,
    });
    markFallback("tool_loop_empty_reply_fallback", "empty_reply_after_tool_loop", reply);
    retries.push({
      stage: "tool_loop_empty_reply_fallback",
      fromModel: modelUsed,
      toModel: modelUsed,
      reason: "empty_reply",
    });
    reply = fallbackReply;
  }

  return {
    reply,
    promptTokens,
    completionTokens,
    modelUsed,
    toolLoopGuardrails,
  };
}
