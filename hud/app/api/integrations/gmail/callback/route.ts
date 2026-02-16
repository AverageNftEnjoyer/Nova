import { NextResponse } from "next/server"

import { exchangeCodeForGmailTokens, parseGmailOAuthState } from "@/lib/integrations/gmail"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function withStatus(returnTo: string, status: "success" | "error", message: string): string {
  const safe = returnTo.startsWith("/") ? returnTo : "/integrations"
  const url = new URL(`http://localhost${safe}`)
  url.searchParams.set("gmail", status)
  url.searchParams.set("message", message)
  return `${url.pathname}${url.search}`
}

export async function GET(req: Request) {
  const requestUrl = new URL(req.url)
  const code = String(requestUrl.searchParams.get("code") || "").trim()
  const stateRaw = String(requestUrl.searchParams.get("state") || "").trim()
  const parsedState = parseGmailOAuthState(stateRaw)
  const returnTo = parsedState?.returnTo || "/integrations"

  if (!parsedState) {
    return NextResponse.redirect(
      new URL(withStatus("/integrations?gmailPopup=1", "error", "Invalid Gmail OAuth state."), requestUrl.origin),
      { status: 302 },
    )
  }
  if (!code) {
    const errorDesc = String(requestUrl.searchParams.get("error_description") || requestUrl.searchParams.get("error") || "Missing OAuth code.")
    return NextResponse.redirect(new URL(withStatus(returnTo, "error", errorDesc), requestUrl.origin), { status: 302 })
  }

  try {
    await exchangeCodeForGmailTokens(code, {
      userId: parsedState.userId,
      allowServiceRole: true,
    })
    return NextResponse.redirect(new URL(withStatus(returnTo, "success", "Gmail connected."), requestUrl.origin), { status: 302 })
  } catch (error) {
    return NextResponse.redirect(
      new URL(withStatus(returnTo, "error", error instanceof Error ? error.message : "Failed to connect Gmail."), requestUrl.origin),
      { status: 302 },
    )
  }
}
