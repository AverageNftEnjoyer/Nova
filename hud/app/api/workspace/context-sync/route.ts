import path from "node:path"
import { NextResponse } from "next/server"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { resolveWorkspaceRoot } from "@/lib/workspace/root"
import {
  syncWorkspaceContextFiles,
  type WorkspaceContextSyncInput,
} from "@/lib/workspace/context-sync"
import { isBlockedAssistantName, MAX_ASSISTANT_NAME_LENGTH } from "@/lib/settings/userSettings"

export const runtime = "nodejs"

function normalizeBody(body: unknown): WorkspaceContextSyncInput {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const nested =
    raw.settings && typeof raw.settings === "object"
      ? (raw.settings as Record<string, unknown>)
      : null
  const source = nested ?? raw
  const interestsRaw = source.interests
  const interests = Array.isArray(interestsRaw)
    ? interestsRaw.map((item) => String(item || "").trim()).filter(Boolean)
    : []

  const assistantNameCandidate = String(source.assistantName || "").trim().slice(0, MAX_ASSISTANT_NAME_LENGTH)
  return {
    assistantName: isBlockedAssistantName(assistantNameCandidate) ? "Nova" : assistantNameCandidate,
    userName: String(source.userName || "").trim(),
    nickname: String(source.nickname || "").trim(),
    occupation: String(source.occupation || "").trim(),
    preferredLanguage: String(source.preferredLanguage || "").trim(),
    communicationStyle: String(source.communicationStyle || "").trim(),
    tone: String(source.tone || "").trim(),
    characteristics: String(source.characteristics || "").trim(),
    customInstructions: String(source.customInstructions || "").trim(),
    interests,
  }
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({}))
    const input = normalizeBody(body)
    const workspaceRoot = resolveWorkspaceRoot()
    const result = await syncWorkspaceContextFiles(workspaceRoot, verified.user.id, input)
    return NextResponse.json({
      ok: true,
      userContextDir: path.relative(workspaceRoot, result.userContextDir),
      updatedFiles: result.updatedFiles.map((filePath) => path.relative(workspaceRoot, filePath)),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to sync workspace context.",
      },
      { status: 500 },
    )
  }
}
