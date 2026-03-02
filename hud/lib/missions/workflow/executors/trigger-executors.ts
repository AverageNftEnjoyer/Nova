/**
 * Trigger Node Executors
 */

import type { ScheduleTriggerNode, ManualTriggerNode, WebhookTriggerNode, EventTriggerNode, NodeOutput, ExecutionContext } from "../../types/index"
import { getLocalParts, parseTime } from "../scheduling"
import { resolveTimezone } from "@/lib/shared/timezone"

const DEFAULT_WINDOW_MINUTES = 10

export async function executeScheduleTrigger(
  node: ScheduleTriggerNode,
  ctx: ExecutionContext,
): Promise<NodeOutput & { port?: string }> {
  if (ctx.runSource === "trigger" || ctx.runSource === "manual") {
    return { ok: true, text: "Manual trigger — schedule gate bypassed.", data: { triggered: true } }
  }

  const now = ctx.now
  const timezone = resolveTimezone(node.triggerTimezone, ctx.mission?.settings?.timezone)
  const local = getLocalParts(now, timezone)
  if (!local) return { ok: false, error: "Could not determine local time.", data: { triggered: false } }

  const mode = node.triggerMode || "daily"

  if (mode === "interval") {
    const every = Math.max(1, node.triggerIntervalMinutes || 30)
    const lastRun = ctx.lastRunAt ? new Date(ctx.lastRunAt) : null
    if (!lastRun || Number.isNaN(lastRun.getTime())) {
      return { ok: true, text: "Interval trigger — first run.", data: { triggered: true, dayStamp: local.dayStamp } }
    }
    const minutesSince = (now.getTime() - lastRun.getTime()) / 60000
    if (minutesSince >= every) {
      return { ok: true, text: `Interval trigger — ${minutesSince.toFixed(1)}m since last run.`, data: { triggered: true, dayStamp: local.dayStamp } }
    }
    return { ok: true, text: "Interval trigger — not yet due.", data: { triggered: false, skipped: true } }
  }

  const target = parseTime(node.triggerTime)
  if (!target) {
    return { ok: false, error: "Invalid trigger time format.", data: { triggered: false } }
  }

  if (mode === "weekly" || mode === "once") {
    const days = node.triggerDays || []
    if (days.length > 0 && !days.includes(local.weekday)) {
      return { ok: true, text: `Weekly trigger — today is ${local.weekday}, not in [${days.join(",")}].`, data: { triggered: false, skipped: true } }
    }
  }

  const nowMinutes = local.hour * 60 + local.minute
  const targetMinutes = target.hour * 60 + target.minute
  if (nowMinutes < targetMinutes) {
    return { ok: true, text: "Schedule trigger — not yet time.", data: { triggered: false, skipped: true } }
  }

  const lag = nowMinutes - targetMinutes
  const window = node.triggerWindowMinutes ?? DEFAULT_WINDOW_MINUTES
  if (lag > window) {
    return { ok: true, text: `Schedule trigger — missed window (${lag}m lag, ${window}m window).`, data: { triggered: false, skipped: true } }
  }

  return {
    ok: true,
    text: `Schedule trigger fired — ${mode} at ${node.triggerTime} ${timezone}.`,
    data: { triggered: true, dayStamp: local.dayStamp, mode, timezone },
  }
}

export async function executeManualTrigger(
  _node: ManualTriggerNode,
  _ctx: ExecutionContext,
): Promise<NodeOutput> {
  void _node
  void _ctx
  return { ok: true, text: "Manual trigger.", data: { triggered: true } }
}

export async function executeWebhookTrigger(
  _node: WebhookTriggerNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  let webhookData: unknown = {}
  const raw = ctx.variables["__webhook_payload"]
  if (raw) {
    try {
      webhookData = JSON.parse(raw)
    } catch {
      return { ok: false, error: "Webhook payload is not valid JSON." }
    }
  }
  return { ok: true, text: "Webhook trigger received.", data: { triggered: true, payload: webhookData } }
}

export async function executeEventTrigger(
  _node: EventTriggerNode,
  _ctx: ExecutionContext,
): Promise<NodeOutput> {
  void _node
  void _ctx
  return { ok: true, text: "Event trigger fired.", data: { triggered: true } }
}
