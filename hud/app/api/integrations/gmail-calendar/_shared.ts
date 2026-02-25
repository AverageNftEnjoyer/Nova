import { NextResponse } from "next/server"
import { z } from "zod"

import { toApiErrorBody, toGmailServiceError } from "@/lib/integrations/gmail/errors"

export const connectQuerySchema = z.object({
  returnTo: z.string().trim().default("/integrations"),
  mode: z.enum(["json"]).optional(),
})

export const disconnectBodySchema = z.object({
  accountId: z.string().trim().toLowerCase().optional(),
})

export async function safeJson(req: Request): Promise<unknown> {
  return req.json().catch(() => ({}))
}

export function logGmailCalendarApi(event: string, payload: Record<string, unknown>): void {
  console.info("[GmailCalendarAPI]", {
    event,
    ts: new Date().toISOString(),
    ...payload,
  })
}

export function gmailCalendarApiErrorResponse(error: unknown, fallback: string): NextResponse {
  const normalized = toGmailServiceError(error, fallback)
  logGmailCalendarApi("error", {
    code: normalized.code,
    status: normalized.status,
    retryable: normalized.retryable,
    message: normalized.message,
  })
  return NextResponse.json(toApiErrorBody(normalized, fallback), {
    status: normalized.status || 500,
  })
}
