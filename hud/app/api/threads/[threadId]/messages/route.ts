import { NextResponse } from "next/server"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"

type IncomingMessage = {
  role: "user" | "assistant"
  content: string
  createdAt: string
  source?: "hud" | "agent" | "voice"
  sender?: string
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const { threadId } = await context.params
  const body = (await req.json().catch(() => ({}))) as { messages?: IncomingMessage[] }
  const messages = Array.isArray(body.messages) ? body.messages : []

  const { data: thread, error: threadError } = await verified.client
    .from("threads")
    .select("id")
    .eq("id", threadId)
    .eq("user_id", verified.user.id)
    .single()

  if (threadError || !thread) {
    return NextResponse.json({ ok: false, error: "Thread not found." }, { status: 404 })
  }

  const { error: deleteError } = await verified.client
    .from("messages")
    .delete()
    .eq("thread_id", threadId)
    .eq("user_id", verified.user.id)

  if (deleteError) {
    return NextResponse.json({ ok: false, error: deleteError.message }, { status: 500 })
  }

  if (messages.length > 0) {
    const rows = messages.map((m) => ({
      thread_id: threadId,
      user_id: verified.user.id,
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
      metadata: {
        source: m.source || null,
        sender: m.sender || null,
      },
      created_at: String(m.createdAt || new Date().toISOString()),
    }))
    const { error: insertError } = await verified.client.from("messages").insert(rows)
    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 })
    }
  }

  await verified.client
    .from("threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("user_id", verified.user.id)

  return NextResponse.json({ ok: true })
}
