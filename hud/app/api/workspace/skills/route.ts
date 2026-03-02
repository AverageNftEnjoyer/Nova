import path from "node:path"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { NextResponse } from "next/server"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import {
  STARTER_SKILLS_CATALOG_VERSION,
  STARTER_SKILL_NAMES,
  SKILL_NAME_PATTERN,
  buildSkillTemplate,
  filterInvokableSkills,
  installStarterSkills,
  listSkillSummaries,
  normalizeSkillName,
  readSkillMeta,
  resolveSkillFilePath,
  resolveSkillsDir,
  validateSkillMarkdown,
  writeSkillMeta,
} from "@/lib/workspace/skills/service"
import { resolveWorkspaceRoot } from "@/lib/workspace/root"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const workspaceRoot = resolveWorkspaceRoot()
    const skillsDir = resolveSkillsDir(workspaceRoot, verified.user.id)
    const url = new URL(req.url)
    const rawName = url.searchParams.get("name")
    if (rawName) {
      const name = normalizeSkillName(rawName)
      if (!SKILL_NAME_PATTERN.test(name)) {
        return NextResponse.json({ ok: false, error: "Invalid skill name." }, { status: 400 })
      }
      const skillPath = resolveSkillFilePath(workspaceRoot, verified.user.id, name)
      const content = await readFile(skillPath, "utf8").catch(() => "")
      if (!content) {
        return NextResponse.json({ ok: false, error: "Skill not found." }, { status: 404 })
      }
      return NextResponse.json({ ok: true, name, content })
    }

    const skills = filterInvokableSkills(await listSkillSummaries(skillsDir))
    return NextResponse.json({ ok: true, skills, seeded: [] })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load skills." },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const raw = (await req.json().catch(() => ({}))) as { action?: unknown; name?: unknown; description?: unknown }
    const action = String(raw.action || "")
      .trim()
      .toLowerCase()

    const workspaceRoot = resolveWorkspaceRoot()
    if (action === "install-starters") {
      const installed = await installStarterSkills(workspaceRoot, verified.user.id, {
        onlyWhenEmpty: false,
        respectDisabled: false,
        markInitialized: true,
      })
      const skills = filterInvokableSkills(await listSkillSummaries(resolveSkillsDir(workspaceRoot, verified.user.id)))
      return NextResponse.json({ ok: true, installed, skills })
    }

    const name = normalizeSkillName(raw.name)
    if (!SKILL_NAME_PATTERN.test(name)) {
      return NextResponse.json(
        { ok: false, error: "Skill name must use lowercase letters, digits, and hyphens only." },
        { status: 400 },
      )
    }

    const skillPath = resolveSkillFilePath(workspaceRoot, verified.user.id, name)
    const existing = await readFile(skillPath, "utf8").catch(() => "")
    if (existing) {
      return NextResponse.json(
        { ok: false, error: "A skill with this name already exists." },
        { status: 409 },
      )
    }

    const content = buildSkillTemplate(name, String(raw.description || "").trim())
    const validation = validateSkillMarkdown(content, name)
    if (validation.errors.length > 0) {
      return NextResponse.json({ ok: false, error: "Template validation failed.", errors: validation.errors }, { status: 500 })
    }

    await mkdir(path.dirname(skillPath), { recursive: true })
    await writeFile(skillPath, validation.normalized, "utf8")

    if (STARTER_SKILL_NAMES.has(name)) {
      const meta = await readSkillMeta(workspaceRoot, verified.user.id)
      if (meta.disabledStarters.includes(name)) {
        await writeSkillMeta(workspaceRoot, verified.user.id, {
          startersInitialized: meta.startersInitialized || true,
          disabledStarters: meta.disabledStarters.filter((item) => item !== name),
          catalogVersion: Math.max(meta.catalogVersion, STARTER_SKILLS_CATALOG_VERSION),
        })
      }
    }

    return NextResponse.json({ ok: true, name, content: validation.normalized })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to create skill." },
      { status: 500 },
    )
  }
}

export async function PUT(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const raw = (await req.json().catch(() => ({}))) as { name?: unknown; content?: unknown }
    const name = normalizeSkillName(raw.name)
    if (!SKILL_NAME_PATTERN.test(name)) {
      return NextResponse.json(
        { ok: false, error: "Skill name must use lowercase letters, digits, and hyphens only." },
        { status: 400 },
      )
    }

    const contentRaw = String(raw.content ?? "")
    const validation = validateSkillMarkdown(contentRaw, name)
    if (validation.errors.length > 0) {
      return NextResponse.json(
        { ok: false, error: "Skill failed validation.", errors: validation.errors },
        { status: 400 },
      )
    }

    const workspaceRoot = resolveWorkspaceRoot()
    const skillPath = resolveSkillFilePath(workspaceRoot, verified.user.id, name)
    await mkdir(path.dirname(skillPath), { recursive: true })
    await writeFile(skillPath, validation.normalized, "utf8")
    return NextResponse.json({ ok: true, name, chars: validation.normalized.length })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to save skill." },
      { status: 500 },
    )
  }
}

export async function DELETE(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const workspaceRoot = resolveWorkspaceRoot()
    const url = new URL(req.url)
    const rawName = url.searchParams.get("name")
    const name = normalizeSkillName(rawName)
    if (!SKILL_NAME_PATTERN.test(name)) {
      return NextResponse.json({ ok: false, error: "Invalid skill name." }, { status: 400 })
    }

    const skillPath = resolveSkillFilePath(workspaceRoot, verified.user.id, name)
    const skillDir = path.dirname(skillPath)
    await rm(skillDir, { recursive: true, force: true })

    if (STARTER_SKILL_NAMES.has(name)) {
      const meta = await readSkillMeta(workspaceRoot, verified.user.id)
      if (!meta.disabledStarters.includes(name)) {
        await writeSkillMeta(workspaceRoot, verified.user.id, {
          startersInitialized: meta.startersInitialized || true,
          disabledStarters: [...meta.disabledStarters, name],
          catalogVersion: Math.max(meta.catalogVersion, STARTER_SKILLS_CATALOG_VERSION),
        })
      }
    }

    const skills = filterInvokableSkills(await listSkillSummaries(resolveSkillsDir(workspaceRoot, verified.user.id)))
    return NextResponse.json({ ok: true, deleted: name, skills })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to delete skill." },
      { status: 500 },
    )
  }
}
