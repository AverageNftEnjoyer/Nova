import { NextResponse } from "next/server"

import { requireLocalUser } from "@/lib/auth/local-user"
import { launchDeploymentRun } from "@/lib/deployments/execution"
import {
  createDeploymentRun,
  findDeploymentRunByIdempotency,
  getDeployment,
  listDeploymentRuns,
  syncDeploymentRuns,
  updateDeploymentRun,
} from "@/lib/deployments/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { userId } = await requireLocalUser()
  syncDeploymentRuns(userId)
  const deploymentId = new URL(req.url).searchParams.get("deploymentId")?.trim() || undefined
  return NextResponse.json({ ok: true, runs: listDeploymentRuns(userId, deploymentId) })
}

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()
  let runId = ""
  try {
    const body = (await req.json().catch(() => ({}))) as {
      deploymentId?: unknown
      idempotencyKey?: unknown
      approved?: unknown
    }
    const deploymentId = String(body.deploymentId ?? "").trim()
    if (!deploymentId) {
      return NextResponse.json({ ok: false, error: "Deployment id is required." }, { status: 400 })
    }
    const deployment = getDeployment(userId, deploymentId)
    if (!deployment) return NextResponse.json({ ok: false, error: "Deployment not found." }, { status: 404 })
    const idempotencyKey = String(body.idempotencyKey ?? "").trim().slice(0, 160)
    const duplicate = idempotencyKey
      ? findDeploymentRunByIdempotency(userId, deployment.id, idempotencyKey)
      : null
    if (duplicate) {
      return NextResponse.json({ ok: true, run: duplicate, duplicate: true }, { status: 200 })
    }
    const run = createDeploymentRun(userId, deployment.id, idempotencyKey)
    runId = run.id
    if (deployment.plan?.reviewRequired && body.approved !== true) {
      const paused = updateDeploymentRun(userId, run.id, {
        status: "paused",
        eventType: "deployment.run.approval_required",
        eventData: { risk: deployment.plan.risk },
      })
      return NextResponse.json({ ok: true, run: paused, outcome: "review_required" }, { status: 202 })
    }
    const launched = await launchDeploymentRun({
      userId,
      deploymentId: deployment.id,
      runId: run.id,
      idempotencyKey: String(body.idempotencyKey ?? run.id).trim(),
    })
    return NextResponse.json({ ok: true, ...launched }, { status: 202 })
  } catch (error) {
    if (runId) {
      try {
        updateDeploymentRun(userId, runId, {
          status: "failed",
          eventType: "deployment.run.failed",
          eventData: { error: error instanceof Error ? error.message : "Launch failed." },
        })
      } catch {}
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to launch deployment." },
      { status: 400 },
    )
  }
}
