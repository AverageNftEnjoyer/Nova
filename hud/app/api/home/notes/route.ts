import { NextResponse } from "next/server"

import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import {
  createHomeNote,
  deleteHomeNote,
  listHomeNotes,
  updateHomeNote,
} from "../../../../../src/runtime/modules/services/notes/index.js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type MutationBody = {
  id?: unknown
  content?: unknown
}

function normalizeId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40)
}

function normalizeContent(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400)
}


export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const userId = verified.user.id
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.homeNotesRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const notes = await listHomeNotes({ userContextId: userId, limit: 200 })
    return NextResponse.json({ ok: true, notes })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load notes." },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const userId = verified.user.id
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.homeNotesWrite)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const body = (await req.json().catch(() => ({}))) as MutationBody
    const content = normalizeContent(body.content)
    if (!content) {
      return NextResponse.json({ ok: false, error: "Note content is required." }, { status: 400 })
    }

    const created = await createHomeNote({
      userContextId: userId,
      content,
      source: "manual",
    })

    if (!created.ok || !created.note) {
      return NextResponse.json(
        { ok: false, error: created.message || "Failed to create note." },
        { status: 400 },
      )
    }

    return NextResponse.json({ ok: true, note: created.note })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to create note." },
      { status: 500 },
    )
  }
}

export async function PATCH(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const userId = verified.user.id
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.homeNotesWrite)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const body = (await req.json().catch(() => ({}))) as MutationBody
    const id = normalizeId(body.id)
    const content = normalizeContent(body.content)

    if (!id) {
      return NextResponse.json({ ok: false, error: "Note id is required." }, { status: 400 })
    }
    if (!content) {
      return NextResponse.json({ ok: false, error: "Note content is required." }, { status: 400 })
    }

    const updated = await updateHomeNote({
      userContextId: userId,
      noteId: id,
      content,
      source: "manual",
    })

    if (!updated.ok || !updated.note) {
      const status = updated.code === "notes.not_found" ? 404 : 400
      return NextResponse.json(
        { ok: false, error: updated.message || "Failed to update note." },
        { status },
      )
    }

    return NextResponse.json({ ok: true, note: updated.note })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to update note." },
      { status: 500 },
    )
  }
}

export async function DELETE(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const userId = verified.user.id
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.homeNotesWrite)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const body = (await req.json().catch(() => ({}))) as MutationBody
    const id = normalizeId(body.id)
    if (!id) {
      return NextResponse.json({ ok: false, error: "Note id is required." }, { status: 400 })
    }

    const deleted = await deleteHomeNote({
      userContextId: userId,
      noteId: id,
    })

    if (!deleted.ok) {
      const status = deleted.code === "notes.not_found" ? 404 : 400
      return NextResponse.json(
        { ok: false, error: deleted.message || "Failed to delete note." },
        { status },
      )
    }

    return NextResponse.json({ ok: true, id, deleted: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to delete note." },
      { status: 500 },
    )
  }
}

