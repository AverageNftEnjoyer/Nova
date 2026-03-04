import { NextResponse } from "next/server"
import { z } from "zod"

import { toApiErrorBody, toYouTubeServiceError } from "@/lib/integrations/youtube/errors/index"

export const connectQuerySchema = z.object({
  returnTo: z.string().trim().max(2048).default("/integrations"),
  mode: z.enum(["json"]).optional(),
})

export const disconnectBodySchema = z.object({})

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.enum(["video", "channel"]).optional(),
  pageToken: z.string().trim().max(256).optional(),
  maxResults: z.coerce.number().int().min(1).max(25).optional(),
})

export const videoQuerySchema = z.object({
  id: z.string().trim().min(1).max(64),
})

export const feedQuerySchema = z.object({
  mode: z.enum(["personalized", "sources"]).default("personalized"),
  topic: z.string().trim().max(80).default("news"),
  pageToken: z.string().trim().max(256).optional(),
  maxResults: z.coerce.number().int().min(4).max(15).optional(),
  historyChannelIds: z.string().trim().max(4096).optional(),
})

export function parseCsv(value: string): string[] {
  return String(value || "")
    .slice(0, 4096)
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 20)
}

export async function safeJson(req: Request): Promise<unknown> {
  return req.json().catch(() => ({}))
}

export function logYouTubeApi(event: string, payload: Record<string, unknown>): void {
  console.info("[YouTubeAPI]", {
    event,
    ts: new Date().toISOString(),
    ...payload,
  })
}

export function youtubeApiErrorResponse(error: unknown, fallback: string): NextResponse {
  const normalized = toYouTubeServiceError(error, fallback)
  logYouTubeApi("error", {
    code: normalized.code,
    status: normalized.status,
    retryable: normalized.retryable,
    message: normalized.message,
  })
  return NextResponse.json(toApiErrorBody(normalized, fallback), {
    status: normalized.status || 500,
  })
}
