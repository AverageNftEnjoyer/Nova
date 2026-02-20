import { NextResponse } from "next/server"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
const DEFAULT_THREAD_TITLE = "Greetings Exchange"

type ApiMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string
  source?: "hud" | "agent" | "voice"
  sender?: string
  nlpCleanText?: string
  nlpConfidence?: number
  nlpCorrectionCount?: number
  nlpBypass?: boolean
}

type ApiConversation = {
  id: string
  title: string
  pinned?: boolean
  archived?: boolean
  messages: ApiMessage[]
  createdAt: string
  updatedAt: string
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const userId = verified.user.id
  const client = verified.client

  const { data: threads, error: threadsError } = await client
    .from("threads")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })

  if (threadsError) {
    return NextResponse.json({ ok: false, error: threadsError.message }, { status: 500 })
  }

  const threadIds = (threads || []).map((t) => String(t.id))
  let messages: Array<{
    id: string
    thread_id: string
    role: string
    content: string
    created_at: string
    metadata?: Record<string, unknown> | null
  }> = []

  if (threadIds.length > 0) {
    const { data: messageRows, error: messagesError } = await client
      .from("messages")
      .select("id,thread_id,role,content,created_at,metadata")
      .in("thread_id", threadIds)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
    if (messagesError) {
      return NextResponse.json({ ok: false, error: messagesError.message }, { status: 500 })
    }
    messages = (messageRows || []) as typeof messages
  }

  const grouped = new Map<string, ApiMessage[]>()
  for (const row of messages) {
    const entry: ApiMessage = {
      id: String(row.id),
      role: row.role === "assistant" ? "assistant" : "user",
      content: String(row.content || ""),
      createdAt: String(row.created_at),
      source: (row.metadata?.source as ApiMessage["source"]) || undefined,
      sender: (row.metadata?.sender as string | undefined) || undefined,
      nlpCleanText: (row.metadata?.nlpCleanText as string | undefined) || undefined,
      nlpConfidence: Number.isFinite(Number(row.metadata?.nlpConfidence)) ? Number(row.metadata?.nlpConfidence) : undefined,
      nlpCorrectionCount: Number.isFinite(Number(row.metadata?.nlpCorrectionCount)) ? Number(row.metadata?.nlpCorrectionCount) : undefined,
      nlpBypass: row.metadata?.nlpBypass === true ? true : undefined,
    }
    const list = grouped.get(row.thread_id) || []
    list.push(entry)
    grouped.set(row.thread_id, list)
  }

  const conversations: ApiConversation[] = (threads || []).map((thread) => ({
    id: String(thread.id),
    title: String(thread.title || DEFAULT_THREAD_TITLE),
    pinned: Boolean((thread as { pinned?: boolean }).pinned),
    archived: Boolean((thread as { archived?: boolean }).archived),
    messages: grouped.get(String(thread.id)) || [],
    createdAt: String(thread.created_at),
    updatedAt: String(thread.updated_at),
  }))

  return NextResponse.json({ ok: true, conversations })
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { title?: string }
  const title = String(body.title || DEFAULT_THREAD_TITLE).trim() || DEFAULT_THREAD_TITLE

  const { data, error } = await verified.client
    .from("threads")
    .insert({
      user_id: verified.user.id,
      title,
      pinned: false,
      archived: false,
    })
    .select("*")
    .single()

  if (error || !data) {
    return NextResponse.json({ ok: false, error: error?.message || "Failed to create conversation." }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    conversation: {
      id: String(data.id),
      title: String(data.title || DEFAULT_THREAD_TITLE),
      pinned: Boolean((data as { pinned?: boolean }).pinned),
      archived: Boolean((data as { archived?: boolean }).archived),
      messages: [],
      createdAt: String(data.created_at),
      updatedAt: String(data.updated_at),
    } satisfies ApiConversation,
  })
}
