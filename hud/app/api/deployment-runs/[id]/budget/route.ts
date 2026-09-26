import { NextResponse } from "next/server"

import { raiseTaskBudget } from "@/lib/agents/task-store"
import type { RaiseAgentTaskBudgetInput } from "@/lib/agents/types"
import { requireLocalUser } from "@/lib/auth/local-user"
import { getDeploymentRun, updateDeploymentRun } from "@/lib/deployments/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireLocalUser()
  const { id } = await params
  const run = getDeploymentRun(userId, id)
  if (!run) return NextResponse.json({ ok: false, error: "Deployment run not found." }, { status: 404 })
  if (!run.agentTaskId) {
    return NextResponse.json({ ok: false, error: "Graph-run budgets cannot be changed after launch." }, { status: 409 })
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      costBudgetUsd?: unknown
      tokenBudget?: unknown
    }
    const task = await raiseTaskBudget(userId, run.agentTaskId, {
      costBudgetUsd: body.costBudgetUsd,
      tokenBudget: body.tokenBudget,
    } as RaiseAgentTaskBudgetInput)
    const updated = updateDeploymentRun(userId, run.id, {
      status: task.status === "queued" ? "queued" : run.status,
      eventType: "deployment.run.budget_updated",
      eventData: {
        costBudgetUsd: task.costBudgetUsd ?? null,
        tokenBudget: task.tokenBudget ?? null,
      },
    })
    return NextResponse.json({ ok: true, run: updated })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Budget update failed." },
      { status: 400 },
    )
  }
}
