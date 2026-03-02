import { NextResponse } from "next/server"

import { buildSpotifyOAuthUrl } from "@/lib/integrations/spotify"
import { spotifyError } from "@/lib/integrations/spotify/errors/index"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { connectQuerySchema, logSpotifyApi, spotifyApiErrorResponse } from "@/app/api/integrations/spotify/_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const url = new URL(req.url)
    const parsed = connectQuerySchema.safeParse({
      returnTo: url.searchParams.get("returnTo") ?? "/integrations",
      mode: url.searchParams.get("mode") ?? undefined,
    })
    if (!parsed.success) {
      throw spotifyError("spotify.invalid_request", parsed.error.issues[0]?.message || "Invalid request.", { status: 400 })
    }
    const { returnTo, mode } = parsed.data
    logSpotifyApi("connect.begin", {
      userContextId: verified.user.id,
      returnTo,
      mode: mode || "redirect",
    })
    const authUrl = await buildSpotifyOAuthUrl(returnTo, verified)
    if (mode === "json") {
      return NextResponse.json({ ok: true, authUrl })
    }
    return NextResponse.redirect(authUrl, { status: 302 })
  } catch (error) {
    return spotifyApiErrorResponse(error, "Failed to start Spotify OAuth.")
  }
}
