import path from "node:path"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { NextResponse } from "next/server"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"

const SKILL_FILE_NAME = "SKILL.md"
const MAX_SKILL_CHARS = 48_000
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const STARTER_SKILLS: Array<{ name: string; description: string }> = [
  {
    name: "nova-core",
    description:
      "Default execution policy for runtime and cross-file implementation work with plan-first and verification gates.",
  },
  {
    name: "research",
    description:
      "Deep factual research workflow for multi-source analysis, source conflicts, and confidence grading.",
  },
  {
    name: "summarize",
    description:
      "Structured summarization workflow for URLs or text with metadata, risk notes, and confidence grading.",
  },
  {
    name: "daily-briefing",
    description:
      "Concise daily briefing workflow combining memory context with date-fresh external updates and uncertainty labels.",
  },
]

type SkillSummary = {
  name: string
  description: string
  updatedAt: string
  chars: number
}

function sanitizeUserContextId(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized.slice(0, 96) || "anonymous"
}

function normalizeSkillName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
}

function toTitleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function resolveSkillsDir(workspaceRoot: string, userId: string): string {
  return path.join(
    path.resolve(workspaceRoot),
    ".agent",
    "user-context",
    sanitizeUserContextId(userId),
    "skills",
  )
}

function resolveSkillFilePath(workspaceRoot: string, userId: string, skillName: string): string {
  return path.join(resolveSkillsDir(workspaceRoot, userId), skillName, SKILL_FILE_NAME)
}

function extractDescriptionFromFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n")
  const match = normalized.match(/^---\n([\s\S]*?)\n---/m)
  if (!match) return "No description provided."
  const frontmatter = match[1] || ""
  const descriptionLine = frontmatter
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^description\s*:/i.test(line))
  if (!descriptionLine) return "No description provided."
  const value = descriptionLine.replace(/^description\s*:/i, "").trim().replace(/^['"]|['"]$/g, "")
  return value || "No description provided."
}

function parseFrontmatter(content: string): { map: Record<string, string>; body: string } | null {
  const normalized = content.replace(/\r\n/g, "\n")
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return null
  const frontmatterRaw = match[1] || ""
  const body = match[2] || ""
  const map: Record<string, string> = {}
  for (const rawLine of frontmatterRaw.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!keyMatch) continue
    const key = keyMatch[1]
    const value = String(keyMatch[2] || "").trim().replace(/^['"]|['"]$/g, "")
    map[key] = value
  }
  return { map, body }
}

function validateSkillMarkdown(contentRaw: string, expectedName: string): { normalized: string; errors: string[] } {
  const errors: string[] = []
  const normalized = String(contentRaw ?? "").replace(/\r\n/g, "\n").trim()

  if (!normalized) {
    return { normalized: "", errors: ["Skill content cannot be empty."] }
  }
  if (normalized.length > MAX_SKILL_CHARS) {
    errors.push(`Skill content exceeds ${MAX_SKILL_CHARS} characters.`)
  }

  const parsed = parseFrontmatter(normalized)
  if (!parsed) {
    errors.push("YAML frontmatter is required and must be fenced by --- lines.")
    return { normalized, errors }
  }

  const keys = Object.keys(parsed.map)
  const uniqueKeys = Array.from(new Set(keys))
  const hasOnlyRequiredKeys =
    uniqueKeys.length === 2 && uniqueKeys.includes("name") && uniqueKeys.includes("description")
  if (!hasOnlyRequiredKeys) {
    errors.push("Frontmatter must include only `name` and `description` keys.")
  }

  if ((parsed.map.name || "").trim() !== expectedName) {
    errors.push(`Frontmatter name must match skill folder name: ${expectedName}`)
  }
  if (!(parsed.map.description || "").trim()) {
    errors.push("Frontmatter `description` cannot be empty.")
  }

  const body = parsed.body
  if (!/^## Activation\s*$/m.test(body)) {
    errors.push("Missing required `## Activation` section.")
  }
  if (!/^## Workflow\s*$/m.test(body)) {
    errors.push("Missing required `## Workflow` section.")
  }
  if (!/^(##|###)\s*(?:\d+\.\s*)?Verification Before Done\s*$/m.test(body)) {
    errors.push("Missing required `Verification Before Done` gate heading.")
  }
  if (!/^## Completion Criteria\s*$/m.test(body)) {
    errors.push("Missing required `## Completion Criteria` section.")
  }

  return { normalized, errors }
}

function buildSkillTemplate(skillName: string, description?: string): string {
  const displayName = toTitleCaseSlug(skillName)
  const desc =
    String(description || "").trim() ||
    `Workflow for ${displayName.toLowerCase()} tasks. Use when the request clearly matches this domain.`
  return [
    "---",
    `name: ${skillName}`,
    `description: ${desc}`,
    "---",
    "",
    `# ${displayName} Skill`,
    "",
    "## Activation",
    "- Use this skill when the request clearly matches this domain.",
    "- Do not use this skill for unrelated tasks.",
    "",
    "## Workflow",
    "### 1. Scope",
    "- Identify the task goal and required output.",
    "",
    "### 2. Execute",
    "- Perform the smallest set of actions needed to complete the task.",
    "",
    "### 3. Verification Before Done",
    "- Validate key outcomes and assumptions.",
    "- Call out uncertainty when full verification is not possible.",
    "",
    "## Completion Criteria",
    "- Output is complete, accurate, and scoped to the request.",
    "- Verification results and residual risk are explicitly stated.",
    "",
  ].join("\n")
}

async function loadStarterSkillContent(
  workspaceRoot: string,
  starterName: string,
  fallbackDescription: string,
): Promise<string> {
  const canonicalPath = path.join(path.resolve(workspaceRoot), "skills", starterName, SKILL_FILE_NAME)
  const canonical = await readFile(canonicalPath, "utf8").catch(() => "")
  if (canonical) {
    const canonicalValidation = validateSkillMarkdown(canonical, starterName)
    if (canonicalValidation.errors.length === 0) {
      return canonicalValidation.normalized
    }
  }
  return buildSkillTemplate(starterName, fallbackDescription)
}

async function installStarterSkills(
  workspaceRoot: string,
  userId: string,
  options?: { onlyWhenEmpty?: boolean },
): Promise<string[]> {
  const skillsDir = resolveSkillsDir(workspaceRoot, userId)
  await mkdir(skillsDir, { recursive: true })

  if (options?.onlyWhenEmpty) {
    const existingSkills = await listSkillSummaries(skillsDir)
    if (existingSkills.length > 0) return []
  }

  const installed: string[] = []
  for (const starter of STARTER_SKILLS) {
    const skillPath = resolveSkillFilePath(workspaceRoot, userId, starter.name)
    const existingContent = await readFile(skillPath, "utf8").catch(() => "")
    if (existingContent) continue

    const rawContent = await loadStarterSkillContent(workspaceRoot, starter.name, starter.description)
    const validated = validateSkillMarkdown(rawContent, starter.name)
    if (validated.errors.length > 0) continue

    await mkdir(path.dirname(skillPath), { recursive: true })
    await writeFile(skillPath, validated.normalized, "utf8")
    installed.push(starter.name)
  }

  return installed
}

async function listSkillSummaries(skillsDir: string): Promise<SkillSummary[]> {
  const entries = await readdir(skillsDir, { withFileTypes: true }).catch(() => [])
  const summaries: SkillSummary[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name.trim()
    if (!SKILL_NAME_PATTERN.test(name)) continue
    const skillPath = path.join(skillsDir, name, SKILL_FILE_NAME)
    const content = await readFile(skillPath, "utf8").catch(() => "")
    if (!content) continue
    const fileStat = await stat(skillPath).catch(() => null)
    summaries.push({
      name,
      description: extractDescriptionFromFrontmatter(content),
      updatedAt: fileStat ? new Date(fileStat.mtimeMs).toISOString() : "",
      chars: content.length,
    })
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name))
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const workspaceRoot = path.resolve(process.cwd(), "..")
    const skillsDir = resolveSkillsDir(workspaceRoot, verified.user.id)
    const seeded = await installStarterSkills(workspaceRoot, verified.user.id, { onlyWhenEmpty: true })
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

    const skills = await listSkillSummaries(skillsDir)
    return NextResponse.json({ ok: true, skills, seeded })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load skills." },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const raw = (await req.json().catch(() => ({}))) as { action?: unknown; name?: unknown; description?: unknown }
    const action = String(raw.action || "")
      .trim()
      .toLowerCase()

    const workspaceRoot = path.resolve(process.cwd(), "..")
    if (action === "install-starters") {
      const installed = await installStarterSkills(workspaceRoot, verified.user.id, { onlyWhenEmpty: false })
      const skills = await listSkillSummaries(resolveSkillsDir(workspaceRoot, verified.user.id))
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
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

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

    const workspaceRoot = path.resolve(process.cwd(), "..")
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
