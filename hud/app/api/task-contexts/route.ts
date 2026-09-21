import { NextResponse } from "next/server"

import {
  createContext,
  deleteContext,
  listContexts,
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

export async function GET(req: Request) {
  const auth = await authorize(req, RATE_LIMIT_POLICIES.agentTasksRead)
  if ("response" in auth) return auth.response

  try {
    const contexts = await listContexts(auth.userId)
    return NextResponse.json({ ok: true, contexts })
  } catch (error) {
    return errorResponse(error, "Failed to load contexts.")
  }
}

export async function POST(req: Request) {
  const auth = await authorize(req, RATE_LIMIT_POLICIES.agentTasksWrite)
  if ("response" in auth) return auth.response

  try {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown }
    const name = String(body.name ?? "").trim()
    if (!name) {
      return NextResponse.json({ ok: false, error: "Context name is required." }, { status: 400 })
    }

    const context = await createContext(auth.userId, name)
    return NextResponse.json({ ok: true, context })
  } catch (error) {
    return errorResponse(error, "Failed to create context.")
  }
}

export async function DELETE(req: Request) {
  const auth = await authorize(req, RATE_LIMIT_POLICIES.agentTasksWrite)
  if ("response" in auth) return auth.response

  try {
    const body = (await req.json().catch(() => ({}))) as { id?: unknown }
    const id = normalizeId(body.id)
    if (!id) {
      return NextResponse.json({ ok: false, error: "Context id is required." }, { status: 400 })
    }

    const deleted = await deleteContext(auth.userId, id)
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Context not found." }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, "Failed to delete context.")
  }
}
