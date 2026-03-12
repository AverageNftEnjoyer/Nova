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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid workspace context payload.")
  }
  const source = body as Record<string, unknown>
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
  if (unauthorized) return unauthorized
  if (!verified?.user?.id) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const body = await req.json()
    const input = normalizeBody(body)
    if (!String(input.userName || "").trim()) {
      return NextResponse.json({ ok: false, error: "userName is required." }, { status: 400 })
    }
    if (!String(input.assistantName || "").trim()) {
      return NextResponse.json({ ok: false, error: "assistantName is required." }, { status: 400 })
    }
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
