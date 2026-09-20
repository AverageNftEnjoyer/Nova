import { NextResponse } from "next/server"

import { ensureTaskRunnerStarted } from "@/lib/agents/task-runner"
import {
  AgentTaskNotFoundError,
  AgentTaskTransitionError,
  AgentTaskValidationError,
  applyTaskAction,
  createTask,
  deleteTask,
  getTaskStats,
  listTasks,
} from "@/lib/agents/task-store"
import type { AgentTaskAction, CreateAgentTaskInput } from "@/lib/agents/types"
import {
  checkUserRateLimit,
  RATE_LIMIT_POLICIES,
  rateLimitExceededResponse,
  type RateLimitPolicy,
} from "@/lib/security/rate-limit"
import { requireLocalUser } from "@/lib/auth/local-user"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACTIONS: readonly AgentTaskAction[] = ["play", "pause", "stop"]

function normalizeId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40)
}

function errorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof AgentTaskValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
  }
  if (error instanceof AgentTaskNotFoundError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
  }
  if (error instanceof AgentTaskTransitionError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 409 })
  }
  return NextResponse.json(
    { ok: false, error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  )
}

async function authorize(_req: Request, policy: RateLimitPolicy): Promise<{ userId: string } | { response: NextResponse }> {
  const { userId } = await requireLocalUser()
  const limitDecision = checkUserRateLimit(userId, policy)
  if (!limitDecision.allowed) return { response: rateLimitExceededResponse(limitDecision) }
  return { userId }
}

export async function GET(req: Request) {
  const auth = await authorize(req, RATE_LIMIT_POLICIES.agentTasksRead)
  if ("response" in auth) return auth.response

  ensureTaskRunnerStarted(auth.userId)
  try {
    const [tasks, stats] = await Promise.all([listTasks(auth.userId), getTaskStats(auth.userId)])
    return NextResponse.json({ ok: true, tasks, stats })
  } catch (error) {
    return errorResponse(error, "Failed to load tasks.")
  }
}

export async function POST(req: Request) {
  const auth = await authorize(req, RATE_LIMIT_POLICIES.agentTasksWrite)
  if ("response" in auth) return auth.response

  ensureTaskRunnerStarted(auth.userId)
  try {
    const body = (await req.json().catch(() => ({}))) as CreateAgentTaskInput
    const task = await createTask(auth.userId, body)
    return NextResponse.json({ ok: true, task })
  } catch (error) {
    return errorResponse(error, "Failed to create task.")
  }
}

export async function PATCH(req: Request) {
  const auth = await authorize(req, RATE_LIMIT_POLICIES.agentTasksWrite)
  if ("response" in auth) return auth.response

  try {
    const body = (await req.json().catch(() => ({}))) as { id?: unknown; action?: unknown }
    const id = normalizeId(body.id)
    if (!id) return NextResponse.json({ ok: false, error: "Task id is required." }, { status: 400 })
    const action = ACTIONS.find((candidate) => candidate === body.action)
    if (!action) return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 })
    const task = await applyTaskAction(auth.userId, id, action)
    return NextResponse.json({ ok: true, task })
  } catch (error) {
    return errorResponse(error, "Failed to update task.")
  }
}

export async function DELETE(req: Request) {
  const auth = await authorize(req, RATE_LIMIT_POLICIES.agentTasksWrite)
  if ("response" in auth) return auth.response

  try {
    const body = (await req.json().catch(() => ({}))) as { id?: unknown }
    const id = normalizeId(body.id)
    if (!id) return NextResponse.json({ ok: false, error: "Task id is required." }, { status: 400 })
    const deleted = await deleteTask(auth.userId, id)
    if (!deleted) return NextResponse.json({ ok: false, error: "Task not found." }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, "Failed to delete task.")
  }
}
