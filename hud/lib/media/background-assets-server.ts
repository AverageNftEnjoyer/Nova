import "server-only"

import { NextResponse } from "next/server"

import { BackgroundAssetError } from "../../../src/media/background-assets.js"

export * from "../../../src/media/background-assets.js"

/** Maps storage errors to JSON responses; anything unexpected becomes a generic 500 (details go to the log). */
export function backgroundAssetErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof BackgroundAssetError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status })
  }
  console.error(`[background-assets] ${fallback}: ${error instanceof Error ? error.message : String(error)}`)
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 })
}
