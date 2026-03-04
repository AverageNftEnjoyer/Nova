import { NextResponse } from "next/server"

import { exchangeCodeForYouTubeTokens, parseYouTubeOAuthState } from "@/lib/integrations/youtube"
import { youtubeError } from "@/lib/integrations/youtube/errors/index"
import { logYouTubeApi } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function sanitizeReturnToPath(value: string): string {
  const raw = String(value || "").trim().slice(0, 2048)
  if (!raw) return "/integrations"
  if (/[\r\n]/.test(raw)) return "/integrations"
  if (!raw.startsWith("/")) return "/integrations"
  if (/^\/{2,}/.test(raw)) return "/integrations"
  if (raw.includes("\\") || /%5c/i.test(raw)) return "/integrations"
  try {
    const parsed = new URL(raw, "http://localhost")
    if (parsed.origin !== "http://localhost") return "/integrations"
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return "/integrations"
  }
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function toSafeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

function normalizeStatusMessage(value: string, fallback: string): string {
  const base = String(value || "").trim() || fallback
  return base.replace(/\s+/g, " ").slice(0, 280)
}

function withStatus(returnTo: string, status: "success" | "error", message: string): string {
  const safe = sanitizeReturnToPath(returnTo)
  const safeMessage = normalizeStatusMessage(message, status === "success" ? "YouTube connected." : "YouTube connection failed.")
  const url = new URL(`http://localhost${safe}`)
  url.searchParams.set("youtube", status)
  url.searchParams.set("message", safeMessage)
  return `${url.pathname}${url.search}`
}

function isPopupFlow(returnTo: string): boolean {
  return returnTo.includes("youtubePopup=1")
}

function popupCloseHtml(params: { status: "success" | "error"; message: string; returnTo: string }): string {
  const displayMessage = normalizeStatusMessage(
    params.message,
    params.status === "success" ? "YouTube connected." : "YouTube connection failed.",
  )
  const nextUrl = withStatus(params.returnTo, params.status, displayMessage)
  const payload = toSafeInlineJson({
    type: "nova:youtube-oauth",
    status: params.status,
    message: displayMessage,
  })
  const nextUrlJson = toSafeInlineJson(nextUrl)
  const safeStatusMessage = escapeHtml(displayMessage || "You can close this window.")
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>YouTube Authorization</title>
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
      <h1>YouTube ${params.status === "success" ? "connected" : "connection failed"}</h1>
      <p id="status">${safeStatusMessage}</p>
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

  const parsedState = parseYouTubeOAuthState(stateRaw)
  const returnTo = parsedState?.returnTo || "/integrations"
  const popupFlow = isPopupFlow(returnTo)

  if (!parsedState) {
    const error = youtubeError("youtube.invalid_state", "Invalid YouTube OAuth state.", { status: 400 })
    logYouTubeApi("callback.invalid_state", { code: error.code, message: error.message })
    return popupCloseResponse({
      status: "error",
      message: error.message,
      returnTo: "/integrations?youtubePopup=1",
    })
  }

  if (!code) {
    const errorDesc = String(requestUrl.searchParams.get("error_description") || requestUrl.searchParams.get("error") || "Missing OAuth code.")
    logYouTubeApi("callback.missing_code", {
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
    logYouTubeApi("callback.exchange.begin", {
      userContextId: parsedState.userId,
      returnTo,
    })
    await exchangeCodeForYouTubeTokens(code, {
      userId: parsedState.userId,
      allowServiceRole: true,
      serviceRoleReason: "youtube-oauth-callback",
    })
    logYouTubeApi("callback.exchange.success", {
      userContextId: parsedState.userId,
      returnTo,
    })
    if (popupFlow) {
      return popupCloseResponse({ status: "success", message: "YouTube connected.", returnTo })
    }
    return NextResponse.redirect(new URL(withStatus(returnTo, "success", "YouTube connected."), requestUrl.origin), { status: 302 })
  } catch (error) {
    const normalized = error instanceof Error ? error.message : "Failed to connect YouTube."
    logYouTubeApi("callback.exchange.failed", {
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
    return NextResponse.redirect(new URL(withStatus(returnTo, "error", normalized), requestUrl.origin), { status: 302 })
  }
}
