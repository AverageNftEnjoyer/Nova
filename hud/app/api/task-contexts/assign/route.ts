import { NextResponse } from "next/server"

import {
  assignTaskToContext,
  removeTaskFromContext,
  TaskContextNotFoundError,
  TaskContextValidationError,
} from "@/lib/agents/context-manager"
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
  if (error instanceof TaskContextValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
  }
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

export async function POST(req: Request) {
  const auth = await authorize(req, RATE_LIMIT_POLICIES.agentTasksWrite)
  if ("response" in auth) return auth.response

  try {
    const body = (await req.json().catch(() => ({}))) as { taskId?: unknown; contextId?: unknown }
    const taskId = normalizeId(body.taskId)
    const contextId = normalizeId(body.contextId)

    if (!taskId) {
      return NextResponse.json({ ok: false, error: "Task id is required." }, { status: 400 })
    }
    if (!contextId) {
      return NextResponse.json({ ok: false, error: "Context id is required." }, { status: 400 })
    }

    await assignTaskToContext(auth.userId, taskId, contextId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, "Failed to assign task to context.")
  }
}

export async function DELETE(req: Request) {
  const auth = await authorize(req, RATE_LIMIT_POLICIES.agentTasksWrite)
  if ("response" in auth) return auth.response

  try {
    const body = (await req.json().catch(() => ({}))) as { taskId?: unknown }
    const taskId = normalizeId(body.taskId)

    if (!taskId) {
      return NextResponse.json({ ok: false, error: "Task id is required." }, { status: 400 })
    }

    const removed = await removeTaskFromContext(auth.userId, taskId)
    if (!removed) {
      return NextResponse.json({ ok: false, error: "Task not in any context." }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, "Failed to remove task from context.")
  }
}
