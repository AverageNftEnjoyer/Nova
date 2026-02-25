import { NextResponse } from "next/server"

import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { loadMissions, upsertMission, deleteMission } from "@/lib/missions/store"
import { getTemplate, instantiateTemplate } from "@/lib/missions/templates"
import type { Mission } from "@/lib/missions/types"
import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { resolveConfiguredLlmProvider } from "@/lib/integrations/provider-selection"
import {
  applyMissionDiff,
  appendMissionOperationJournalEntry,
  deriveDiffOperationsFromMissionSnapshot,
  type MissionDiffOperation,
} from "@/lib/missions/workflow/diff"
import { appendMissionVersionEntry, validateMissionGraphForVersioning } from "@/lib/missions/workflow/versioning"
import { emitMissionTelemetryEvent } from "@/lib/missions/telemetry"
import { loadSchedules, saveSchedules } from "@/lib/notifications/store"
import { purgePendingMessagesForMission } from "@/lib/novachat/pending-messages"
import { purgeMissionDerivedData } from "@/lib/missions/purge"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const NATIVE_MISSIONS_API_ENFORCED = String(process.env.NOVA_MISSIONS_NATIVE_API_ENFORCED || "1").trim().toLowerCase() !== "0"


function hasLegacyMissionPayloadShape(input: unknown): boolean {
  if (!input || typeof input !== "object") return false
  const row = input as Record<string, unknown>
  // Native mission payloads always include graph fields; do not classify those as legacy.
  if (Array.isArray(row.nodes) || Array.isArray(row.connections)) return false
  return (
    typeof row.message === "string" ||
    typeof row.time === "string" ||
    typeof row.timezone === "string" ||
    typeof row.enabled === "boolean" ||
    typeof row.integration === "string" ||
    Array.isArray(row.chatIds) ||
    Array.isArray(row.workflowSteps)
  )
}

/**
 * GET /api/missions
 * Returns all missions for the authenticated user.
 * Auto-migrates legacy NotificationSchedule records on first access.
 */
export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const userId = verified.user.id

  const url = new URL(req.url)
  const id = url.searchParams.get("id")
  const limitParam = url.searchParams.get("limit")
  const offsetParam = url.searchParams.get("offset")

  try {
    const missions = await loadMissions({ userId })
    if (id) {
      const mission = missions.find((m) => m.id === id) ?? null
      if (!mission) {
        return NextResponse.json({ ok: false, error: "Mission not found." }, { status: 404 })
      }
      return NextResponse.json({ ok: true, mission })
    }
    const total = missions.length
    const offset = Math.max(0, Number.isFinite(Number(offsetParam)) ? Number(offsetParam) : 0)
    const limit = limitParam != null && Number.isFinite(Number(limitParam)) ? Math.min(Math.max(1, Number(limitParam)), 500) : undefined
    const paginated = limit != null ? missions.slice(offset, offset + limit) : missions.slice(offset)
    return NextResponse.json({ ok: true, missions: paginated, total, offset, limit: limit ?? total })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to load missions." },
      { status: 500 },
    )
  }
}

/**
 * POST /api/missions
 * Create or update a mission.
 */
export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const userId = verified.user.id
  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionSave)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  let body: {
    mission?: Mission
    templateId?: string
    missionId?: string
    expectedVersion?: number
    operations?: MissionDiffOperation[]
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 })
  }

  if (typeof body.templateId === "string" && body.templateId.trim()) {
    const template = getTemplate(body.templateId.trim())
    if (!template) {
      return NextResponse.json({ ok: false, error: "Mission template not found." }, { status: 404 })
    }
    try {
      const integrations = await loadIntegrationsConfig(verified)
      const selected = resolveConfiguredLlmProvider(integrations)
      const mission = instantiateTemplate(template, userId, {
        aiIntegration: selected.provider,
        aiModel: selected.model,
      })
      await upsertMission(mission, userId)
      await appendMissionVersionEntry({
        userContextId: userId,
        mission,
        actorId: userId,
        eventType: "snapshot",
        reason: `Template instantiated: ${body.templateId.trim()}`,
        sourceMissionVersion: mission.version,
      })
      return NextResponse.json({ ok: true, mission })
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "Failed to save mission template." },
        { status: 500 },
      )
    }
  }

  const mission = body.mission
  const missionId = typeof body.missionId === "string" ? body.missionId.trim() : ""
  const requestedOperations = Array.isArray(body.operations) ? body.operations : null
  const expectedVersion = Number.isFinite(Number(body.expectedVersion))
    ? Number(body.expectedVersion)
    : undefined

  if (missionId && requestedOperations) {
    try {
      const missions = await loadMissions({ userId })
      const current = missions.find((row) => row.id === missionId)
      if (!current) {
        return NextResponse.json({ ok: false, error: "Mission not found." }, { status: 404 })
      }
      const diffResult = applyMissionDiff({
        mission: current,
        operations: requestedOperations,
        expectedVersion,
      })
      await appendMissionOperationJournalEntry({
        userContextId: userId,
        actorId: userId,
        missionId,
        ts: new Date().toISOString(),
        expectedVersion,
        previousVersion: current.version,
        nextVersion: diffResult.mission?.version,
        ok: diffResult.ok,
        operationCount: requestedOperations.length,
        appliedCount: diffResult.appliedCount,
        issueCount: diffResult.issues.length,
        operations: requestedOperations,
        issues: diffResult.issues,
      })
      if (!diffResult.ok || !diffResult.mission) {
        await emitMissionTelemetryEvent({
          eventType: "mission.validation.completed",
          status: "error",
          userContextId: userId,
          missionId,
          metadata: {
            stage: "diff_apply",
            blocked: true,
            operationCount: requestedOperations.length,
            issueCount: diffResult.issues.length,
          },
        }).catch(() => {})
        return NextResponse.json(
          {
            ok: false,
            error: "Mission diff apply failed.",
            validation: {
              blocked: true,
              issues: diffResult.issues,
            },
          },
          { status: 409 },
        )
      }
      await emitMissionTelemetryEvent({
        eventType: "mission.validation.completed",
        status: "success",
        userContextId: userId,
        missionId,
        metadata: {
          stage: "diff_apply",
          blocked: false,
          operationCount: requestedOperations.length,
          issueCount: diffResult.issues.length,
        },
      }).catch(() => {})
      await upsertMission(diffResult.mission, userId)
      await appendMissionVersionEntry({
        userContextId: userId,
        mission: diffResult.mission,
        actorId: userId,
        eventType: "snapshot",
        reason: "Mission diff apply",
        sourceMissionVersion: diffResult.mission.version,
      })
      return NextResponse.json({ ok: true, mission: diffResult.mission, diff: { appliedCount: diffResult.appliedCount } })
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "Failed to apply mission diff." },
        { status: 500 },
      )
    }
  }

  if (!mission || !mission.id) {
    return NextResponse.json({ ok: false, error: "Mission with id is required." }, { status: 400 })
  }
  if (NATIVE_MISSIONS_API_ENFORCED && hasLegacyMissionPayloadShape(mission)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Legacy workflow payloads are blocked. Submit native mission graph payloads only (nodes + connections).",
      },
      { status: 400 },
    )
  }
  if (typeof mission.label !== "string" || !mission.label.trim()) {
    return NextResponse.json({ ok: false, error: "Mission label is required." }, { status: 400 })
  }
  if (!Array.isArray(mission.nodes)) {
    return NextResponse.json({ ok: false, error: "Mission nodes must be an array." }, { status: 400 })
  }
  if (!Array.isArray(mission.connections)) {
    return NextResponse.json({ ok: false, error: "Mission connections must be an array." }, { status: 400 })
  }
  const graphIssues = validateMissionGraphForVersioning(mission)
  if (graphIssues.length > 0) {
    await emitMissionTelemetryEvent({
      eventType: "mission.validation.completed",
      status: "error",
      userContextId: userId,
      missionId: mission.id,
      metadata: {
        stage: "save_graph",
        blocked: true,
        issueCount: graphIssues.length,
      },
    }).catch(() => {})
    return NextResponse.json(
      {
        ok: false,
        error: "Mission graph validation failed.",
        validation: {
          blocked: true,
          issues: graphIssues,
        },
      },
      { status: 400 },
    )
  }
  await emitMissionTelemetryEvent({
    eventType: "mission.validation.completed",
    status: "success",
    userContextId: userId,
    missionId: mission.id,
    metadata: {
      stage: "save_graph",
      blocked: false,
      issueCount: 0,
    },
  }).catch(() => {})

  try {
    const missions = await loadMissions({ userId })
    const current = missions.find((row) => row.id === mission.id)
    if (current) {
      const operations = deriveDiffOperationsFromMissionSnapshot(current, {
        ...mission,
        userId,
      })
      const diffResult = applyMissionDiff({
        mission: current,
        operations,
        expectedVersion,
      })
      await appendMissionOperationJournalEntry({
        userContextId: userId,
        actorId: userId,
        missionId: mission.id,
        ts: new Date().toISOString(),
        expectedVersion,
        previousVersion: current.version,
        nextVersion: diffResult.mission?.version,
        ok: diffResult.ok,
        operationCount: operations.length,
        appliedCount: diffResult.appliedCount,
        issueCount: diffResult.issues.length,
        operations,
        issues: diffResult.issues,
      })
      if (!diffResult.ok || !diffResult.mission) {
        await emitMissionTelemetryEvent({
          eventType: "mission.validation.completed",
          status: "error",
          userContextId: userId,
          missionId: mission.id,
          metadata: {
            stage: "snapshot_diff_apply",
            blocked: true,
            operationCount: operations.length,
            issueCount: diffResult.issues.length,
          },
        }).catch(() => {})
        return NextResponse.json(
          {
            ok: false,
            error: "Mission diff apply failed.",
            validation: {
              blocked: true,
              issues: diffResult.issues,
            },
          },
          { status: 409 },
        )
      }
      await emitMissionTelemetryEvent({
        eventType: "mission.validation.completed",
        status: "success",
        userContextId: userId,
        missionId: mission.id,
        metadata: {
          stage: "snapshot_diff_apply",
          blocked: false,
          operationCount: operations.length,
          issueCount: diffResult.issues.length,
        },
      }).catch(() => {})
      await upsertMission(diffResult.mission, userId)
      await appendMissionVersionEntry({
        userContextId: userId,
        mission: diffResult.mission,
        actorId: userId,
        eventType: "snapshot",
        reason: "Mission snapshot update",
        sourceMissionVersion: diffResult.mission.version,
      })
      return NextResponse.json({ ok: true, mission: diffResult.mission, diff: { appliedCount: diffResult.appliedCount } })
    }
    const createdMission = { ...mission, userId }
    await upsertMission(createdMission, userId)
    await appendMissionVersionEntry({
      userContextId: userId,
      mission: createdMission,
      actorId: userId,
      eventType: "snapshot",
      reason: "Mission created",
      sourceMissionVersion: createdMission.version,
    })
    return NextResponse.json({ ok: true, mission: createdMission })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to save mission." },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/missions?id=<missionId>
 * Delete a mission by ID.
 */
export async function DELETE(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const userId = verified.user.id
  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionSave)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  const url = new URL(req.url)
  const id = url.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ ok: false, error: "Mission id query param is required." }, { status: 400 })
  }

  console.info(
    JSON.stringify({
      event: "mission.delete.request",
      missionId: id,
      userContextId: userId,
    }),
  )

  try {
    const missionDelete = await deleteMission(id, userId)
    if (!missionDelete.ok) {
      console.warn(
        JSON.stringify({
          event: "mission.delete.invalid_user",
          missionId: id,
          userContextId: userId,
        }),
      )
      return NextResponse.json({ ok: false, deleted: false, reason: "invalid_user" }, { status: 400 })
    }

    let scheduleDeleted = false
    const schedules = await loadSchedules({ userId })
    const nextSchedules = schedules.filter((schedule) => schedule.id !== id)
    if (nextSchedules.length !== schedules.length) {
      await saveSchedules(nextSchedules, { userId })
      scheduleDeleted = true
    }

    // Purge novachat pending messages
    await purgePendingMessagesForMission(userId, id).catch(() => {})

    // Purge all calendar and derived data for this mission (reschedule overrides,
    // telemetry, version snapshots, run logs). Non-fatal — logged internally.
    purgeMissionDerivedData(userId, id).catch((err) => {
      console.error(
        JSON.stringify({
          event: "mission.delete.purge_derived_data.error",
          missionId: id,
          userContextId: userId,
          error: err instanceof Error ? err.message : "unknown",
        }),
      )
    })

    const deleted = missionDelete.deleted || scheduleDeleted
    const reason = deleted ? "deleted" : "not_found"
    console.info(
      JSON.stringify({
        event: "mission.delete.result",
        missionId: id,
        userContextId: userId,
        deleted,
        reason,
      }),
    )
    return NextResponse.json({
      ok: true,
      deleted,
      reason,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to delete mission." },
      { status: 500 },
    )
  }
}
