import { NextResponse } from "next/server"

import { getContext, getContextTaskIds, TaskContextNotFoundError } from "@/lib/agents/context-manager"
import { listTasks } from "@/lib/agents/task-store"
import { requireLocalUser } from "@/lib/auth/local-user"
import {
  checkUserRateLimit,
  RATE_LIMIT_POLICIES,
  rateLimitExceededResponse,
  type RateLimitPolicy,
} from "@/lib/security/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40)
}

function errorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof TaskContextNotFoundError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
  }
  return NextResponse.json(
    { ok: false, error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  )
}

async function authorize(
  _req: Request,
  policy: RateLimitPolicy,
): Promise<{ userId: string } | { response: NextResponse }> {
  const { userId } = await requireLocalUser()
  const limitDecision = checkUserRateLimit(userId, policy)
  if (!limitDecision.allowed) return { response: rateLimitExceededResponse(limitDecision) }
  return { userId }
}

export async function GET(
  _req: Request,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params
  const auth = await authorize(_req, RATE_LIMIT_POLICIES.agentTasksRead)
  if ("response" in auth) return auth.response

  const contextId = normalizeId(params.id)
  if (!contextId) {
    return NextResponse.json({ ok: false, error: "Context id is required." }, { status: 400 })
  }

  try {
    const context = await getContext(auth.userId, contextId)
    if (!context) {
      return NextResponse.json({ ok: false, error: "Context not found." }, { status: 404 })
    }

    const [taskIds, allTasks] = await Promise.all([
      getContextTaskIds(auth.userId, contextId),
      listTasks(auth.userId),
    ])

    const tasks = allTasks.filter((task) => taskIds.includes(task.id))

    return NextResponse.json({ ok: true, context, tasks })
  } catch (error) {
    return errorResponse(error, "Failed to load context tasks.")
  }
}
