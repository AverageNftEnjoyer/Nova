import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { requireLocalUser } from "@/lib/auth/local-user"
import { createDeployment, getDeployment, listDeployments, projectLegacyDeployments, updateDeployment } from "@/lib/deployments/store"
import type { CreateDeploymentInput } from "@/lib/deployments/types"
import { buildMission, loadMissions, upsertMission } from "@/lib/missions/store"
import { appendMissionVersionEntry } from "@/lib/missions/workflow/versioning/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const { userId } = await requireLocalUser()
  projectLegacyDeployments(userId)
  return NextResponse.json({ ok: true, deployments: listDeployments(userId) })
}

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<CreateDeploymentInput>
    if (body.kind !== "task" && body.kind !== "automation") {
      return NextResponse.json({ ok: false, error: "Deployment kind must be task or automation." }, { status: 400 })
    }
    const outcome = String(body.outcome ?? "").trim()
    if (!outcome) {
      return NextResponse.json({ ok: false, error: "Deployment outcome is required." }, { status: 400 })
    }
    const requestedMissionId = String(body.missionId ?? "").trim()
    const existingMission = requestedMissionId
      ? (await loadMissions({ userId })).find((mission) => mission.id === requestedMissionId)
      : undefined
    if (requestedMissionId && !existingMission) {
      return NextResponse.json({ ok: false, error: "Automation definition not found." }, { status: 404 })
    }
    if (existingMission) {
      const existing = getDeployment(userId, existingMission.id)
      if (existing) return NextResponse.json({ ok: true, deployment: existing })
    }
    const id = existingMission?.id ?? randomUUID()
    const title = String(body.title ?? "").trim().slice(0, 120) || outcome.slice(0, 80)
    if (!existingMission) {
      const definition = buildMission({
        userId,
        label: title,
        description: outcome,
        category: "personal",
        tags: ["deployment", body.kind],
      })
      definition.id = id
      await upsertMission(definition, userId)
      await appendMissionVersionEntry({
        userContextId: userId,
        mission: definition,
        actorId: "deployment-api",
        eventType: "snapshot",
        reason: "Initial deployment definition",
      })
    }

    const deployment = createDeployment(userId, {
      id,
      kind: body.kind,
      status: body.status ?? "draft",
      title,
      outcome,
      acceptanceCriteria: body.acceptanceCriteria,
      plan: body.plan,
      config: body.config,
      missionId: id,
    })
    return NextResponse.json({ ok: true, deployment }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to create deployment." },
      { status: 400 },
    )
  }
}

export async function PATCH(req: Request) {
  const { userId } = await requireLocalUser()
  try {
    const body = (await req.json().catch(() => ({}))) as {
      id?: unknown
      expectedRevision?: unknown
      title?: unknown
      outcome?: unknown
      acceptanceCriteria?: unknown
      config?: unknown
      status?: unknown
    }
    const id = String(body.id ?? "").trim()
    const expectedRevision = Number(body.expectedRevision)
    if (!id || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return NextResponse.json({ ok: false, error: "Deployment id and expected revision are required." }, { status: 400 })
    }
    const current = getDeployment(userId, id)
    if (!current) return NextResponse.json({ ok: false, error: "Deployment not found." }, { status: 404 })
    const deploymentsStatus = ["draft", "ready", "active", "paused", "archived"] as const
    const status = deploymentsStatus.find((candidate) => candidate === body.status)
    const deployment = updateDeployment(userId, id, expectedRevision, {
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.outcome === "string" ? { outcome: body.outcome } : {}),
      ...(Array.isArray(body.acceptanceCriteria)
        ? { acceptanceCriteria: body.acceptanceCriteria.filter((entry): entry is string => typeof entry === "string") }
        : {}),
      ...(body.config && typeof body.config === "object" ? { config: body.config } : {}),
      ...(status ? { status } : {}),
    })
    if (deployment.missionId) {
      const mission = (await loadMissions({ userId })).find((candidate) => candidate.id === deployment.missionId)
      if (mission) {
        const updatedMission = {
          ...mission,
          label: deployment.title,
          description: deployment.outcome,
          version: Math.max(mission.version + 1, deployment.revision),
          updatedAt: new Date().toISOString(),
        }
        await upsertMission(updatedMission, userId)
        await appendMissionVersionEntry({
          userContextId: userId,
          mission: updatedMission,
          actorId: "deployment-api",
          eventType: "snapshot",
          reason: `Deployment revision ${deployment.revision}`,
          sourceMissionVersion: mission.version,
        })
      }
    }
    return NextResponse.json({ ok: true, deployment })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update deployment."
    return NextResponse.json({ ok: false, error: message }, { status: message.includes("revision") ? 409 : 400 })
  }
}
