import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { disconnectSpotify } from "@/lib/integrations/spotify"

import { disconnectBodySchema, logSpotifyApi, safeJson, spotifyApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()

  try {
    const body = await safeJson(req)
    const parsed = disconnectBodySchema.safeParse(body)
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid request body.")
    }
    await disconnectSpotify(verified)
    logSpotifyApi("disconnect.success", { userContextId: userId })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return spotifyApiErrorResponse(error, "Failed to disconnect Spotify.")
  }
}
