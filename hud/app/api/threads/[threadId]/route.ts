import { NextResponse } from "next/server"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function PATCH(
  req: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const { threadId } = await context.params
  const body = (await req.json().catch(() => ({}))) as {
    title?: string
    pinned?: boolean
    archived?: boolean
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.title === "string" && body.title.trim()) update.title = body.title.trim()
  if (typeof body.pinned === "boolean") update.pinned = body.pinned
  if (typeof body.archived === "boolean") update.archived = body.archived

  const { error } = await verified.client
    .from("threads")
    .update(update)
    .eq("id", threadId)
    .eq("user_id", verified.user.id)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const { threadId } = await context.params
  const { error } = await verified.client
    .from("threads")
    .delete()
    .eq("id", threadId)
    .eq("user_id", verified.user.id)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
