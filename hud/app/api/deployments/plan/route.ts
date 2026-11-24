import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { requireLocalUser } from "@/lib/auth/local-user"
import { createDeployment } from "@/lib/deployments/store"
import type { DeploymentPlan } from "@/lib/deployments/types"
import { completeWithConfiguredLlm } from "@/lib/missions/llm/providers"
import { buildMission, upsertMission } from "@/lib/missions/store"
import { buildMissionFromPrompt } from "@/lib/missions/workflow/generate-mission"
import { appendMissionVersionEntry } from "@/lib/missions/workflow/versioning/service"
import {
  buildDeploymentPlanningPrompt,
  parseDeploymentPlan,
} from "../../../../../src/runtime/modules/chat/deployments/planner/index.js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface PlanRequest {
  outcome?: unknown
  conversationId?: unknown
  proposal?: unknown
}

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()
  try {
    const body = (await req.json().catch(() => ({}))) as PlanRequest
    const outcome = String(body.outcome ?? "").trim()
    if (!outcome) {
      return NextResponse.json({ ok: false, error: "Describe the outcome you want to deploy." }, { status: 400 })
    }
    if (outcome.length > 8_000) {
      return NextResponse.json({ ok: false, error: "Outcome must be 8,000 characters or fewer." }, { status: 400 })
    }

    const conversationId = String(body.conversationId ?? "").trim().slice(0, 120)
    const prompt = buildDeploymentPlanningPrompt({ outcome, userContextId: userId, conversationId })
    const proposal = String(body.proposal ?? "").trim()
    const completion = proposal
      ? null
      : await completeWithConfiguredLlm(
          prompt.systemText,
          prompt.userText,
          1_800,
          { userId },
          undefined,
          {
            source: "utility",
            refId: conversationId || "deployment-plan",
            callSite: "deployment.plan",
          },
        )
    const plan = parseDeploymentPlan(proposal || completion?.text || "", {
      outcome,
      routing: prompt.routing,
    }) as DeploymentPlan

    const deploymentId = randomUUID()
    const title = plan.outcome.split(/\r?\n/)[0]?.slice(0, 80) || "New Deployment"
    const definition = plan.kind === "automation"
      ? (await buildMissionFromPrompt(plan.outcome, { userId, scope: { userId } })).mission
      : buildMission({
          userId,
          label: title,
          description: plan.outcome,
          category: "personal",
          tags: ["deployment", plan.kind],
          nodes: [],
          connections: [],
        })
    definition.id = deploymentId
    await upsertMission(definition, userId)
    await appendMissionVersionEntry({
      userContextId: userId,
      mission: definition,
      actorId: "nova-deployment-manager",
      eventType: "snapshot",
      reason: "Initial deployment definition",
    })

    const deployment = createDeployment(userId, {
      id: deploymentId,
      kind: plan.kind,
      status: "ready",
      title,
      outcome: plan.outcome,
      acceptanceCriteria: plan.acceptanceCriteria,
      plan,
      missionId: deploymentId,
      config: {
        costBudgetUsd: plan.budgetEstimate.costUsd,
        tokenBudget: plan.budgetEstimate.tokens,
        permissionMode: plan.reviewRequired ? "plan-mode" : "default",
      },
    })

    return NextResponse.json({
      ok: true,
      deployment,
      plan,
      outcome: plan.kind === "task" ? "task_planned" : "automation_planned",
      model: completion ? { provider: completion.provider, model: completion.model } : null,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Nova could not build a deployment plan." },
      { status: 500 },
    )
  }
}
