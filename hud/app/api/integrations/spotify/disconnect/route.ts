import { NextResponse } from "next/server"

import { disconnectSpotify } from "@/lib/integrations/spotify"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { disconnectBodySchema, logSpotifyApi, safeJson, spotifyApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const body = await safeJson(req)
    const parsed = disconnectBodySchema.safeParse(body)
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid request body.")
    }
    await disconnectSpotify(verified)
    logSpotifyApi("disconnect.success", { userContextId: verified.user.id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return spotifyApiErrorResponse(error, "Failed to disconnect Spotify.")
  }
}
