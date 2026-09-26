import { NextResponse } from "next/server"

import { applyTaskAction } from "@/lib/agents/task-store"
import { requireLocalUser } from "@/lib/auth/local-user"
import { launchDeploymentRun } from "@/lib/deployments/execution"
import { getDeploymentRun, updateDeploymentRun } from "@/lib/deployments/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireLocalUser()
  const { id } = await params
  const run = getDeploymentRun(userId, id)
  if (!run) return NextResponse.json({ ok: false, error: "Deployment run not found." }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as { decision?: unknown }
  const decision = String(body.decision ?? "")
  if (decision !== "approve" && decision !== "deny") {
    return NextResponse.json({ ok: false, error: "Decision must be approve or deny." }, { status: 400 })
  }
  try {
    if (!run.agentTaskId && !run.jobRunId) {
      if (decision === "deny") {
        const denied = updateDeploymentRun(userId, run.id, {
          status: "cancelled",
          eventType: "deployment.run.denied",
        })
        return NextResponse.json({ ok: true, run: denied })
      }
      const launched = await launchDeploymentRun({
        userId,
        deploymentId: run.deploymentId,
        runId: run.id,
        idempotencyKey: `approval:${run.id}`,
      })
      return NextResponse.json({ ok: true, ...launched })
    }
    if (!run.agentTaskId) {
      return NextResponse.json({ ok: false, error: "This run has no pending approval." }, { status: 409 })
    }
    await applyTaskAction(userId, run.agentTaskId, decision === "approve" ? "play" : "stop")
    const updated = updateDeploymentRun(userId, run.id, {
      status: decision === "approve" ? "queued" : "cancelled",
      eventType: decision === "approve" ? "deployment.run.approved" : "deployment.run.denied",
    })
    return NextResponse.json({ ok: true, run: updated })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Approval action failed." },
      { status: 409 },
    )
  }
}
