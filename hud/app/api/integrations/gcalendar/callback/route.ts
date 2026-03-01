/**
 * Legacy Google Calendar OAuth callback alias.
 *
 * Backward compatibility for configurations still pointing to:
 * /api/integrations/gcalendar/callback
 */
import { GET as gmailCalendarCallbackGet } from "@/app/api/integrations/gmail-calendar/callback/route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return gmailCalendarCallbackGet(req)
}
