import { NextResponse } from "next/server"

import { requireLocalUser } from "@/lib/auth/local-user"
import {
  checkUserRateLimit,
  RATE_LIMIT_POLICIES,
  rateLimitExceededResponse,
} from "@/lib/security/rate-limit"
import {
  BodyParseError,
  BodyTooLargeError,
  MAX_UI_STORAGE_BODY_BYTES,
  readJsonBodyLimited,
} from "@/lib/settings/ui-storage/request-body"
import { listUiStorage, UiStorageValidationError, writeUiStorage } from "@/lib/settings/ui-storage/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Server-side mirror of the browser settings that must survive closes and origin changes (see
// lib/settings/ui-storage/keys.ts). Local single-user app: the user is the fixed local user.

export async function GET() {
  try {
    const { userId } = await requireLocalUser()
    const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.uiStorageRead)
    if (!limit.allowed) return rateLimitExceededResponse(limit)
    return NextResponse.json({ ok: true, items: listUiStorage(userId) })
  } catch (error) {
    console.error(`[ui-storage] GET failed: ${error instanceof Error ? error.message : String(error)}`)
    return NextResponse.json({ ok: false, error: "Failed to load settings." }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const { userId } = await requireLocalUser()
    const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.uiStorageWrite)
    if (!limit.allowed) return rateLimitExceededResponse(limit)

    let body: unknown
    try {
      body = await readJsonBodyLimited(req, MAX_UI_STORAGE_BODY_BYTES)
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 413 })
      }
      if (error instanceof BodyParseError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
      }
      throw error
    }

    const items = (body as { items?: unknown } | null)?.items
    if (!items || typeof items !== "object" || Array.isArray(items)) {
      return NextResponse.json({ ok: false, error: "Body must be { items: { [key]: string | null } }." }, { status: 400 })
    }
    const result = writeUiStorage(userId, items as Record<string, string | null>)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof UiStorageValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    }
    console.error(`[ui-storage] PUT failed: ${error instanceof Error ? error.message : String(error)}`)
    return NextResponse.json({ ok: false, error: "Failed to save settings." }, { status: 500 })
  }
}
