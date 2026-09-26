import { NextResponse } from "next/server"

import { applyTaskAction } from "@/lib/agents/task-store"
import { requireLocalUser } from "@/lib/auth/local-user"
import { getDeploymentRun, updateDeploymentRun } from "@/lib/deployments/store"
import { jobLedger } from "@/lib/missions/job-ledger/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireLocalUser()
  const { id } = await params
  const run = getDeploymentRun(userId, id)
  if (!run) return NextResponse.json({ ok: false, error: "Deployment run not found." }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as { action?: unknown }
  const action = String(body.action ?? "")

  try {
    if (action === "cancel") {
      if (run.agentTaskId) await applyTaskAction(userId, run.agentTaskId, "stop")
      if (run.jobRunId) await jobLedger.cancelRun({ jobRunId: run.jobRunId, userId })
      const updated = updateDeploymentRun(userId, run.id, {
        status: "cancelled",
        eventType: "deployment.run.cancelled",
      })
      return NextResponse.json({ ok: true, run: updated })
    }
    if ((action === "pause" || action === "resume") && run.agentTaskId) {
      await applyTaskAction(userId, run.agentTaskId, action === "pause" ? "pause" : "play")
      const updated = updateDeploymentRun(userId, run.id, {
        status: action === "pause" ? "paused" : "queued",
        eventType: action === "pause" ? "deployment.run.paused" : "deployment.run.resumed",
      })
      return NextResponse.json({ ok: true, run: updated })
    }
    return NextResponse.json(
      { ok: false, error: "This action is not available for the current deployment run." },
      { status: 409 },
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Deployment action failed." },
      { status: 409 },
    )
  }
}
