import { NextResponse } from "next/server"

import { requireLocalUser } from "@/lib/auth/local-user"
import { listUiStorage, UiStorageValidationError, writeUiStorage } from "@/lib/settings/ui-storage/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Server-side mirror of the browser settings that must survive closes and origin changes (see
// lib/settings/ui-storage/keys.ts). Local single-user app: the user is the fixed local user.

export async function GET() {
  try {
    const { userId } = await requireLocalUser()
    return NextResponse.json({ ok: true, items: listUiStorage(userId) })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load settings." },
      { status: 500 },
    )
  }
}

export async function PUT(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 })
  }
  const items = (body as { items?: unknown } | null)?.items
  if (!items || typeof items !== "object" || Array.isArray(items)) {
    return NextResponse.json({ ok: false, error: "Body must be { items: { [key]: string | null } }." }, { status: 400 })
  }

  try {
    const { userId } = await requireLocalUser()
    const result = writeUiStorage(userId, items as Record<string, string | null>)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof UiStorageValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to save settings." },
      { status: 500 },
    )
  }
}
