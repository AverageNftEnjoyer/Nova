/**
 * Executor Registry — maps each MissionNodeType to its executor function
 */

import type { MissionNode, NodeOutput, ExecutionContext } from "../../types"
import { executeScheduleTrigger, executeManualTrigger, executeWebhookTrigger, executeEventTrigger } from "./trigger-executors"
import { executeWebSearch, executeHttpRequest, executeRssFeed, executeCoinbase } from "./data-executors"
import { executeAiSummarize, executeAiClassify, executeAiExtract, executeAiGenerate, executeAiChat } from "./ai-executors"
import { executeCondition, executeSwitch, executeLoop, executeMerge, executeSplit, executeWait } from "./logic-executors"
import { executeSetVariables, executeCode, executeFormat, executeFilter, executeSort, executeDedupe } from "./transform-executors"
import { executeTelegramOutput, executeDiscordOutput, executeEmailOutput, executeWebhookOutput, executeSlackOutput } from "./output-executors"

export type NodeExecutor = (node: MissionNode, ctx: ExecutionContext) => Promise<NodeOutput & { port?: string }>

export const EXECUTOR_REGISTRY: Record<string, NodeExecutor> = {
  // Triggers
  "schedule-trigger": (n, c) => executeScheduleTrigger(n as Parameters<typeof executeScheduleTrigger>[0], c),
  "manual-trigger": (n, c) => executeManualTrigger(n as Parameters<typeof executeManualTrigger>[0], c),
  "webhook-trigger": (n, c) => executeWebhookTrigger(n as Parameters<typeof executeWebhookTrigger>[0], c),
  "event-trigger": (n, c) => executeEventTrigger(n as Parameters<typeof executeEventTrigger>[0], c),
  // Data
  "web-search": (n, c) => executeWebSearch(n as Parameters<typeof executeWebSearch>[0], c),
  "http-request": (n, c) => executeHttpRequest(n as Parameters<typeof executeHttpRequest>[0], c),
  "rss-feed": (n, c) => executeRssFeed(n as Parameters<typeof executeRssFeed>[0], c),
  "coinbase": (n, c) => executeCoinbase(n as Parameters<typeof executeCoinbase>[0], c),
  "file-read": async () => ({ ok: false, error: "file-read not yet supported in server execution." }),
  "form-input": async () => ({ ok: false, error: "form-input is not executable in scheduled missions." }),
  // AI
  "ai-summarize": (n, c) => executeAiSummarize(n as Parameters<typeof executeAiSummarize>[0], c),
  "ai-classify": (n, c) => executeAiClassify(n as Parameters<typeof executeAiClassify>[0], c),
  "ai-extract": (n, c) => executeAiExtract(n as Parameters<typeof executeAiExtract>[0], c),
  "ai-generate": (n, c) => executeAiGenerate(n as Parameters<typeof executeAiGenerate>[0], c),
  "ai-chat": (n, c) => executeAiChat(n as Parameters<typeof executeAiChat>[0], c),
  // Logic
  "condition": (n, c) => executeCondition(n as Parameters<typeof executeCondition>[0], c),
  "switch": (n, c) => executeSwitch(n as Parameters<typeof executeSwitch>[0], c),
  "loop": (n, c) => executeLoop(n as Parameters<typeof executeLoop>[0], c),
  "merge": (n, c) => executeMerge(n as Parameters<typeof executeMerge>[0], c),
  "split": (n, c) => executeSplit(n as Parameters<typeof executeSplit>[0], c),
  "wait": (n, c) => executeWait(n as Parameters<typeof executeWait>[0], c),
  // Transform
  "set-variables": (n, c) => executeSetVariables(n as Parameters<typeof executeSetVariables>[0], c),
  "code": (n, c) => executeCode(n as Parameters<typeof executeCode>[0], c),
  "format": (n, c) => executeFormat(n as Parameters<typeof executeFormat>[0], c),
  "filter": (n, c) => executeFilter(n as Parameters<typeof executeFilter>[0], c),
  "sort": (n, c) => executeSort(n as Parameters<typeof executeSort>[0], c),
  "dedupe": (n, c) => executeDedupe(n as Parameters<typeof executeDedupe>[0], c),
  // Output
  "telegram-output": (n, c) => executeTelegramOutput(n as Parameters<typeof executeTelegramOutput>[0], c),
  "discord-output": (n, c) => executeDiscordOutput(n as Parameters<typeof executeDiscordOutput>[0], c),
  "email-output": (n, c) => executeEmailOutput(n as Parameters<typeof executeEmailOutput>[0], c),
  "webhook-output": (n, c) => executeWebhookOutput(n as Parameters<typeof executeWebhookOutput>[0], c),
  "slack-output": (n, c) => executeSlackOutput(n as Parameters<typeof executeSlackOutput>[0], c),
  // Utility (no-op executors)
  "sticky-note": async () => ({ ok: true, text: "" }),
  "sub-workflow": async () => ({ ok: false, error: "sub-workflow execution not yet implemented." }),
}
