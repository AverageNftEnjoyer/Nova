import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { NextResponse } from "next/server"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { resolveWorkspaceRoot } from "@/lib/workspace/root"

export const runtime = "nodejs"

const MAX_MEMORY_FILE_CHARS = 12_000

function sanitizeUserContextId(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized.slice(0, 96) || "anonymous"
}

function resolveMemoryFilePath(workspaceRoot: string, userId: string): string {
  return path.join(
    path.resolve(workspaceRoot),
    ".agent",
    "user-context",
    sanitizeUserContextId(userId),
    "MEMORY.md",
  )
}

function defaultMemoryTemplate(): string {
  return [
    "# Persistent Memory",
    "This file is loaded into every conversation.",
    "",
    "## Key Decisions",
    "",
    "## Project Status",
    "",
    "## Important Facts",
    "",
    "## Preferences Learned",
    "",
  ].join("\n")
}

async function readOrInitMemoryFile(memoryFilePath: string): Promise<string> {
  try {
    return await readFile(memoryFilePath, "utf8")
  } catch {
    const seed = defaultMemoryTemplate()
    await mkdir(path.dirname(memoryFilePath), { recursive: true })
    await writeFile(memoryFilePath, seed, "utf8")
    return seed
  }
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const workspaceRoot = resolveWorkspaceRoot()
    const memoryFilePath = resolveMemoryFilePath(workspaceRoot, verified.user.id)
    const content = await readOrInitMemoryFile(memoryFilePath)
    return NextResponse.json({ ok: true, content })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load MEMORY.md." },
      { status: 500 },
    )
  }
}

export async function PUT(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const raw = (await req.json().catch(() => ({}))) as { content?: unknown }
    const normalized = String(raw.content ?? "")
      .replace(/\r\n/g, "\n")
      .trim()
      .slice(0, MAX_MEMORY_FILE_CHARS)
    const content = normalized || defaultMemoryTemplate()
    const workspaceRoot = resolveWorkspaceRoot()
    const memoryFilePath = resolveMemoryFilePath(workspaceRoot, verified.user.id)
    await mkdir(path.dirname(memoryFilePath), { recursive: true })
    await writeFile(memoryFilePath, content, "utf8")
    return NextResponse.json({ ok: true, chars: content.length })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to save MEMORY.md." },
      { status: 500 },
    )
  }
}
