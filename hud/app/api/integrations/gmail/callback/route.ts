import { NextResponse } from "next/server"

import { exchangeCodeForGmailTokens, parseGmailOAuthState } from "@/lib/integrations/gmail"
import { parseGmailCalendarOAuthState } from "@/lib/integrations/gmail-calendar/service"
import { gmailError } from "@/lib/integrations/gmail/errors"
import { logGmailApi } from "@/app/api/integrations/gmail/_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function withStatus(returnTo: string, status: "success" | "error", message: string): string {
  const safe = returnTo.startsWith("/") ? returnTo : "/integrations"
  const url = new URL(`http://localhost${safe}`)
  url.searchParams.set("gmail", status)
  url.searchParams.set("message", message)
  return `${url.pathname}${url.search}`
}

function isPopupFlow(returnTo: string): boolean {
  return returnTo.includes("gmailPopup=1")
}

function popupCloseHtml(params: { status: "success" | "error"; message: string; returnTo: string }): string {
  const nextUrl = withStatus(params.returnTo, params.status, params.message)
  const payload = JSON.stringify({
    type: "nova:gmail-oauth",
    status: params.status,
    message: params.message,
  })
  const nextUrlJson = JSON.stringify(nextUrl)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Gmail Authorization</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        font-family: Segoe UI, Inter, system-ui, sans-serif;
        background: #080b12; color: #dce7ff;
      }
      .card {
        width: min(92vw, 420px); padding: 20px; border-radius: 14px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(15,19,30,0.9);
      }
      h1 { margin: 0 0 10px; font-size: 16px; font-weight: 600; }
      p { margin: 0; font-size: 13px; line-height: 1.45; color: #b7c8ee; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Gmail ${params.status === "success" ? "connected" : "connection failed"}</h1>
      <p id="status">${params.message.replace(/</g, "&lt;").replace(/>/g, "&gt;") || "You can close this window."}</p>
    </div>
    <script>
      (function () {
        var payload = ${payload};
        var nextUrl = ${nextUrlJson};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, window.location.origin);
          }
        } catch {}
        try { window.close(); } catch {}
        setTimeout(function () {
          if (window.closed) return;
          try {
            if (window.opener && !window.opener.closed) {
              window.opener.location.assign(nextUrl);
            }
          } catch {}
          var el = document.getElementById("status");
          if (el) el.textContent = "Authorization finished. You can close this window.";
        }, 450);
      })();
    </script>
  </body>
</html>`
}

function popupCloseResponse(params: { status: "success" | "error"; message: string; returnTo: string }): NextResponse {
  return new NextResponse(popupCloseHtml(params), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}

export async function GET(req: Request) {
  const requestUrl = new URL(req.url)
  const code = String(requestUrl.searchParams.get("code") || "").trim()
  const stateRaw = String(requestUrl.searchParams.get("state") || "").trim()

  // Compatibility bridge: if Google is configured with the Gmail callback URI only,
  // calendar OAuth may still land here. Forward it to the dedicated calendar callback.
  const parsedCalendarState = parseGmailCalendarOAuthState(stateRaw)
  if (parsedCalendarState) {
    const forwardUrl = new URL("/api/integrations/gmail-calendar/callback", requestUrl.origin)
    requestUrl.searchParams.forEach((value, key) => {
      forwardUrl.searchParams.set(key, value)
    })
    return NextResponse.redirect(forwardUrl, { status: 302 })
  }

  const parsedState = parseGmailOAuthState(stateRaw)
  const returnTo = parsedState?.returnTo || "/integrations"
  const popupFlow = isPopupFlow(returnTo)

  if (!parsedState) {
    const error = gmailError("gmail.invalid_state", "Invalid Gmail OAuth state.", { status: 400 })
    logGmailApi("callback.invalid_state", { code: error.code, message: error.message })
    return popupCloseResponse({
      status: "error",
      message: error.message,
      returnTo: "/integrations?gmailPopup=1",
    })
  }
  if (!code) {
    const errorDesc = String(requestUrl.searchParams.get("error_description") || requestUrl.searchParams.get("error") || "Missing OAuth code.")
    logGmailApi("callback.missing_code", {
      userContextId: parsedState.userId,
      returnTo,
      error: errorDesc,
    })
    if (popupFlow) {
      return popupCloseResponse({ status: "error", message: errorDesc, returnTo })
    }
    return NextResponse.redirect(new URL(withStatus(returnTo, "error", errorDesc), requestUrl.origin), { status: 302 })
  }

  try {
    logGmailApi("callback.exchange.begin", {
      userContextId: parsedState.userId,
      returnTo,
    })
    await exchangeCodeForGmailTokens(code, {
      userId: parsedState.userId,
      allowServiceRole: true,
      serviceRoleReason: "gmail-oauth-callback",
    })
    logGmailApi("callback.exchange.success", {
      userContextId: parsedState.userId,
      returnTo,
    })
    if (popupFlow) {
      return popupCloseResponse({ status: "success", message: "Gmail connected.", returnTo })
    }
    return NextResponse.redirect(new URL(withStatus(returnTo, "success", "Gmail connected."), requestUrl.origin), { status: 302 })
  } catch (error) {
    const normalized = error instanceof Error ? error.message : "Failed to connect Gmail."
    logGmailApi("callback.exchange.failed", {
      userContextId: parsedState.userId,
      returnTo,
      error: normalized,
    })
    if (popupFlow) {
      return popupCloseResponse({
        status: "error",
        message: normalized,
        returnTo,
      })
    }
    return NextResponse.redirect(
      new URL(withStatus(returnTo, "error", normalized), requestUrl.origin),
      { status: 302 },
    )
  }
}
