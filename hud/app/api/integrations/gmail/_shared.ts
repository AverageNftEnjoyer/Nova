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

export const accountsBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_primary"),
    accountId: z.string().trim().toLowerCase().min(1, "accountId is required."),
  }),
  z.object({
    action: z.literal("set_enabled"),
    accountId: z.string().trim().toLowerCase().min(1, "accountId is required."),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("delete"),
    accountId: z.string().trim().toLowerCase().min(1, "accountId is required."),
  }),
])

export const summaryInputSchema = z.object({
  maxResults: z.coerce.number().int().min(1).max(25).default(8),
  accountId: z.string().trim().toLowerCase().optional(),
})

export async function safeJson(req: Request): Promise<unknown> {
  return req.json().catch(() => ({}))
}

export function logGmailApi(event: string, payload: Record<string, unknown>): void {
  console.info("[GmailAPI]", {
    event,
    ts: new Date().toISOString(),
    ...payload,
  })
}

export function gmailApiErrorResponse(
  error: unknown,
  fallback: string,
): NextResponse {
  const normalized = toGmailServiceError(error, fallback)
  logGmailApi("error", {
    code: normalized.code,
    status: normalized.status,
    retryable: normalized.retryable,
    message: normalized.message,
  })
  return NextResponse.json(toApiErrorBody(normalized, fallback), {
    status: normalized.status || 500,
  })
}

