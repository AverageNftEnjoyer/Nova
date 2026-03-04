import { NextResponse } from "next/server"

import { disconnectYouTube } from "@/lib/integrations/youtube"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { disconnectBodySchema, logYouTubeApi, safeJson, youtubeApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  try {
    const body = await safeJson(req)
    const parsed = disconnectBodySchema.safeParse(body)
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid request body.")
    }
    await disconnectYouTube(verified)
    logYouTubeApi("disconnect.success", { userContextId: verified.user.id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return youtubeApiErrorResponse(error, "Failed to disconnect YouTube.")
  }
}
