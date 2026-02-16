import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdminClient, requireSupabaseApiUser } from "@/lib/supabase/server"
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env"

export const runtime = "nodejs"

async function verifyPassword(email: string, password: string): Promise<boolean> {
  const url = getSupabaseUrl()
  const anon = getSupabaseAnonKey()
  const verifier = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await verifier.auth.signInWithPassword({ email, password })
  return !error
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { password?: string }
  const password = String(body.password || "").trim()
  if (!password) {
    return NextResponse.json({ ok: false, error: "Password is required." }, { status: 400 })
  }

  const email = String(verified.user.email || "").trim().toLowerCase()
  if (!email) {
    return NextResponse.json({ ok: false, error: "Current account email is missing." }, { status: 400 })
  }

  const validPassword = await verifyPassword(email, password)
  if (!validPassword) {
    return NextResponse.json({ ok: false, error: "Invalid password confirmation." }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  const userId = verified.user.id

  await admin.from("tool_runs").delete().eq("user_id", userId)
  await admin.from("thread_summaries").delete().eq("user_id", userId)
  await admin.from("messages").delete().eq("user_id", userId)
  await admin.from("memories").delete().eq("user_id", userId)
  await admin.from("threads").delete().eq("user_id", userId)

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError) {
    return NextResponse.json({ ok: false, error: deleteError.message || "Failed to delete account." }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

