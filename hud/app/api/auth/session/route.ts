import { NextResponse } from "next/server"

import { attachSessionCookie, createSessionToken, isAuthConfigured, readSessionFromRequest } from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const configured = await isAuthConfigured()
  const session = readSessionFromRequest(req)
  const refreshedToken = session ? createSessionToken(session.sub) : ""
  const response = NextResponse.json({
    ok: true,
    configured,
    authenticated: Boolean(session),
    subject: session?.sub || null,
    expiresAt: session ? new Date(session.exp * 1000).toISOString() : null,
    sessionToken: refreshedToken || null,
  })
  if (refreshedToken) {
    attachSessionCookie(response, refreshedToken)
  }
  return response
}
