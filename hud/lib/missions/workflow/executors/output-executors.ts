/**
 * Output Node Executors
 */

import "server-only"

import type {
  TelegramOutputNode,
  DiscordOutputNode,
  EmailOutputNode,
  WebhookOutputNode,
  SlackOutputNode,
  NodeOutput,
  ExecutionContext,
} from "../../types"
import { dispatchOutput } from "../../output/dispatch"
import { humanizeMissionOutputText } from "../../output/formatters"
import { applyMissionOutputQualityGuardrails } from "../../output/quality"
import { aggregateUpstreamNodeText, buildDeterministicMorningBriefing } from "../../output/briefing-presenter"
import type { NotificationSchedule } from "@/lib/notifications/store"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveOutputText(node: { inputExpression?: string; messageTemplate?: string }, ctx: ExecutionContext): string {
  if (node.inputExpression) {
    const resolved = ctx.resolveExpr(node.inputExpression)
    if (resolved.trim()) return resolved
  }
  if (node.messageTemplate) {
    const rendered = ctx.resolveExpr(node.messageTemplate)
    if (rendered.trim()) return rendered
  }
  const deterministicBriefing = buildDeterministicMorningBriefing({
    mission: ctx.mission,
    nodeOutputs: ctx.nodeOutputs,
  })
  if (deterministicBriefing) return deterministicBriefing

  if (ctx.mission) {
    for (let index = ctx.mission.nodes.length - 1; index >= 0; index -= 1) {
      const missionNode = ctx.mission.nodes[index]
      const isAiNode = missionNode.type === "ai-summarize"
        || missionNode.type === "ai-classify"
        || missionNode.type === "ai-extract"
        || missionNode.type === "ai-generate"
        || missionNode.type === "ai-chat"
      if (!isAiNode) continue
      const output = ctx.nodeOutputs.get(missionNode.id)
      const text = String(output?.text || "").trim()
      if (output?.ok && text) return text
    }
  }

  const aggregated = aggregateUpstreamNodeText({
    mission: ctx.mission,
    nodeOutputs: ctx.nodeOutputs,
    maxChars: 2200,
    perNodeMaxChars: 360,
  })
  if (aggregated.trim()) return aggregated

  // Fall back to the last node's output text
  let lastText = ""
  for (const [, output] of ctx.nodeOutputs.entries()) {
    if (output.text) lastText = output.text
  }
  return lastText
}

async function dispatchToChannel(
  channel: string,
  text: string,
  chatIds: string[],
  ctx: ExecutionContext,
  metadata?: {
    nodeId?: string
    outputIndex?: number
  },
): Promise<NodeOutput> {
  if (!text.trim()) {
    return { ok: false, error: "No output text to send." }
  }

  const humanized = humanizeMissionOutputText(text, undefined, {
    includeSources: true,
    detailLevel: "standard",
  })
  // Collect fetch/search results from upstream nodes to enable guardrail fallback generation
  const fetchResults: unknown[] = []
  for (const [, nodeOut] of ctx.nodeOutputs.entries()) {
    const items = (nodeOut.data as Record<string, unknown> | null)?.items
    if (Array.isArray(items) && items.length > 0) fetchResults.push(...items)
  }
  const guardrailContext = fetchResults.length > 0 ? { fetchResults } : undefined
  const { text: guarded } = applyMissionOutputQualityGuardrails(humanized, guardrailContext)

  const legacySchedule: NotificationSchedule = {
    id: ctx.missionId || "",
    userId: String(ctx.scope?.userId || ctx.scope?.user?.id || ""),
    label: ctx.missionLabel,
    integration: channel,
    chatIds,
    timezone: ctx.mission?.settings?.timezone || "America/New_York",
    message: "",
    time: "09:00",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runCount: 0,
    successCount: 0,
    failureCount: 0,
  }

  try {
    const results = await dispatchOutput(
      channel,
      guarded,
      chatIds,
      legacySchedule,
      ctx.scope,
      {
        missionRunId: ctx.runId,
        runKey: ctx.runKey,
        attempt: ctx.attempt,
        source: ctx.runSource === "scheduler" ? "scheduler" : "trigger",
        nodeId: metadata?.nodeId,
        outputIndex: metadata?.outputIndex,
      },
    )
    const first = results[0] ?? { ok: false, error: "No result returned" }
    return {
      ok: first.ok,
      text: guarded,
      data: results,
      ...(first.ok ? {} : { error: first.error, errorCode: first.status ? `HTTP_${first.status}` : undefined }),
    }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

export async function executeTelegramOutput(
  node: TelegramOutputNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const text = resolveOutputText(node, ctx)
  const chatIds = node.chatIds || ctx.mission?.chatIds || []
  return dispatchToChannel("telegram", text, chatIds, ctx, { nodeId: node.id, outputIndex: 0 })
}

// ─── Discord ──────────────────────────────────────────────────────────────────

export async function executeDiscordOutput(
  node: DiscordOutputNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const text = resolveOutputText(node, ctx)
  const webhookUrls = node.webhookUrls || ctx.mission?.chatIds || []
  return dispatchToChannel("discord", text, webhookUrls, ctx, { nodeId: node.id, outputIndex: 0 })
}

// ─── Email ────────────────────────────────────────────────────────────────────

export async function executeEmailOutput(
  node: EmailOutputNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const text = resolveOutputText(node, ctx)
  const recipients = node.recipients || ctx.mission?.chatIds || []
  return dispatchToChannel("email", text, recipients, ctx, { nodeId: node.id, outputIndex: 0 })
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

export async function executeWebhookOutput(
  node: WebhookOutputNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const text = resolveOutputText(node, ctx)
  const url = ctx.resolveExpr(node.url)
  if (!url.trim()) {
    return { ok: false, error: "Webhook output URL is empty." }
  }
  return dispatchToChannel("webhook", text, [url], ctx, { nodeId: node.id, outputIndex: 0 })
}

// ─── Slack ────────────────────────────────────────────────────────────────────

export async function executeSlackOutput(
  node: SlackOutputNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const text = resolveOutputText(node, ctx)
  const webhookUrl = node.webhookUrl ? ctx.resolveExpr(node.webhookUrl) : (ctx.mission?.chatIds?.[0] || "")
  return dispatchToChannel("slack", text, webhookUrl ? [webhookUrl] : [], ctx, { nodeId: node.id, outputIndex: 0 })
}
