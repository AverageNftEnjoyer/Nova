import { NextResponse } from "next/server"

import {
  attachSessionCookie,
  createSessionToken,
  guardLoginRateLimit,
  isAuthConfigured,
  registerLoginAttempt,
  requireSameOriginMutation,
  verifyLoginPassword,
} from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const invalidOrigin = requireSameOriginMutation(req)
  if (invalidOrigin) return invalidOrigin
  const rateLimit = guardLoginRateLimit(req)
  if (rateLimit) return rateLimit

  try {
    if (!(await isAuthConfigured())) {
      return NextResponse.json({ ok: false, error: "Auth is not configured yet. Run setup first." }, { status: 409 })
    }
    const body = (await req.json().catch(() => ({}))) as { password?: string }
    const valid = await verifyLoginPassword(String(body.password || ""))
    if (!valid) {
      registerLoginAttempt(req, false)
      return NextResponse.json({ ok: false, error: "Invalid credentials." }, { status: 401 })
    }
    registerLoginAttempt(req, true)
    const token = createSessionToken()
    const response = NextResponse.json({ ok: true, sessionToken: token })
    attachSessionCookie(response, token)
    return response
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Login failed." },
      { status: 500 },
    )
  }
}
