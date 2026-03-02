import "server-only"

import { NextResponse } from "next/server"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export async function requireSupabaseSession(request: Request): Promise<{
  unauthorized: NextResponse | null
  userId: string | null
}> {
  const { unauthorized, verified } = await requireSupabaseApiUser(request)
  if (unauthorized || !verified?.user?.id) {
    return { unauthorized: unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 }), userId: null }
  }
  return { unauthorized: null, userId: verified.user.id }
}
