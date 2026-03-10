import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const requestUrl = new URL(req.url)
  const callbackPath = "/api/integrations/gmail-calendar/callback"
  return NextResponse.json(
    {
      error: "google_calendar_callback_deprecated",
      message: `Legacy callback route is disabled. Configure Google OAuth redirect URI to ${callbackPath}.`,
      callbackPath,
      host: requestUrl.host,
    },
    {
      status: 410,
      headers: {
        "cache-control": "no-store",
      },
    },
  )
}
