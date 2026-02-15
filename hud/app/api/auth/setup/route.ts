import { NextResponse } from "next/server"

import { createSessionToken, attachSessionCookie, isAuthConfigured, requireSameOriginMutation, setPasswordForLocalAuth } from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const invalidOrigin = requireSameOriginMutation(req)
  if (invalidOrigin) return invalidOrigin

  try {
    if (await isAuthConfigured()) {
      return NextResponse.json({ ok: false, error: "Auth is already configured." }, { status: 409 })
    }
    const body = (await req.json().catch(() => ({}))) as { password?: string }
    const password = String(body.password || "")
    await setPasswordForLocalAuth(password)
    const token = createSessionToken()
    const response = NextResponse.json({ ok: true, sessionToken: token })
    attachSessionCookie(response, token)
    return response
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to setup auth." },
      { status: 400 },
    )
  }
}
