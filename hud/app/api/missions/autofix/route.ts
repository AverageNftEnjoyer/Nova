import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { executeWorkflowAutofix } from "@/lib/missions/workflow/autofix"

import type { WorkflowSummary } from "@/lib/missions/types"
import type { WorkflowValidationMode, WorkflowValidationProfile } from "@/lib/missions/workflow/validation"
import { emitMissionTelemetryEvent } from "@/lib/missions/telemetry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseMode(value: unknown): WorkflowValidationMode {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "minimal" || normalized === "full") return normalized
  return "full"
}

function parseProfile(value: unknown): WorkflowValidationProfile {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "minimal" || normalized === "runtime" || normalized === "strict" || normalized === "ai-friendly") {
    return normalized
  }
  return "strict"
}

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()

  let body: {
    summary?: WorkflowSummary
    apply?: boolean
    approvedFixIds?: string[]
    mode?: WorkflowValidationMode
    profile?: WorkflowValidationProfile
    scheduleId?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 })
  }

  if (!body?.summary || typeof body.summary !== "object") {
    return NextResponse.json({ ok: false, error: "summary is required." }, { status: 400 })
  }

  const result = executeWorkflowAutofix({
    summary: body.summary,
    apply: body.apply === true,
    approvedFixIds: Array.isArray(body.approvedFixIds) ? body.approvedFixIds : [],
    stage: "save",
    mode: parseMode(body.mode),
    profile: parseProfile(body.profile),
    userContextId: userId,
    scheduleId: typeof body.scheduleId === "string" && body.scheduleId.trim() ? body.scheduleId.trim() : undefined,
  })

  await emitMissionTelemetryEvent({
    eventType: "mission.autofix.completed",
    status: result.blocked ? "warning" : "success",
    userContextId: userId,
    scheduleId: typeof body.scheduleId === "string" && body.scheduleId.trim() ? body.scheduleId.trim() : undefined,
    metadata: {
      applied: body.apply === true,
      blocked: result.blocked,
      candidateCount: result.candidates.length,
      appliedCount: result.appliedFixIds.length,
      pendingApprovalCount: result.pendingApprovalFixIds.length,
      issueBefore: result.issueReduction.before,
      issueAfter: result.issueReduction.after,
      profile: parseProfile(body.profile),
      mode: parseMode(body.mode),
    },
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    autofix: result,
  })
}
