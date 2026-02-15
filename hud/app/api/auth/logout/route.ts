import { NextResponse } from "next/server"

import { clearSessionCookie, requireSameOriginMutation } from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const invalidOrigin = requireSameOriginMutation(req)
  if (invalidOrigin) return invalidOrigin

  const response = NextResponse.json({ ok: true })
  clearSessionCookie(response)
  return response
}
