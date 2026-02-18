import path from "node:path"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { NextResponse } from "next/server"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"

const SKILL_FILE_NAME = "SKILL.md"
const SKILL_META_FILE_NAME = ".meta.json"
const MAX_SKILL_CHARS = 48_000
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SUPPORTED_FRONTMATTER_KEYS = new Set([
  "argument-hint",
  "compatibility",
  "description",
  "disable-model-invocation",
  "license",
  "metadata",
  "name",
  "user-invokable",
])
const STARTER_SKILLS_CATALOG_VERSION = 2
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
  {
    name: "pickup",
    description:
      "Rapid context rehydration workflow that checks repo state, running processes, and next actions before execution.",
  },
  {
    name: "handoff",
    description:
      "Structured handoff workflow that captures status, risks, checks, and precise next steps for seamless continuation.",
  },
]
const STARTER_SKILL_NAMES = new Set(STARTER_SKILLS.map((skill) => skill.name))

type SkillMeta = {
  startersInitialized: boolean
  disabledStarters: string[]
  catalogVersion: number
}

type SkillSummary = {
  name: string
  description: string
  readWhen: string[]
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

function resolveSkillMetaPath(workspaceRoot: string, userId: string): string {
  return path.join(resolveSkillsDir(workspaceRoot, userId), SKILL_META_FILE_NAME)
}

async function readSkillMeta(workspaceRoot: string, userId: string): Promise<SkillMeta> {
  const skillsDir = resolveSkillsDir(workspaceRoot, userId)
  await mkdir(skillsDir, { recursive: true })
  const raw = await readFile(resolveSkillMetaPath(workspaceRoot, userId), "utf8").catch(() => "")
  if (!raw) {
    return { startersInitialized: false, disabledStarters: [], catalogVersion: 0 }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SkillMeta>
    const disabled = Array.isArray(parsed.disabledStarters)
      ? parsed.disabledStarters.map((value) => normalizeSkillName(value)).filter((value) => STARTER_SKILL_NAMES.has(value))
      : []
    const catalogVersion = Number.isFinite(parsed.catalogVersion)
      ? Math.max(0, Number(parsed.catalogVersion || 0))
      : 0
    return {
      startersInitialized: Boolean(parsed.startersInitialized),
      disabledStarters: Array.from(new Set(disabled)),
      catalogVersion,
    }
  } catch {
    return { startersInitialized: false, disabledStarters: [], catalogVersion: 0 }
  }
}

async function writeSkillMeta(workspaceRoot: string, userId: string, meta: SkillMeta): Promise<void> {
  const skillsDir = resolveSkillsDir(workspaceRoot, userId)
  await mkdir(skillsDir, { recursive: true })
  await writeFile(
    resolveSkillMetaPath(workspaceRoot, userId),
    JSON.stringify(
      {
        startersInitialized: Boolean(meta.startersInitialized),
        disabledStarters: Array.from(new Set(meta.disabledStarters.map((value) => normalizeSkillName(value)).filter((value) => STARTER_SKILL_NAMES.has(value)))),
        catalogVersion: Number.isFinite(meta.catalogVersion) ? Math.max(0, Number(meta.catalogVersion || 0)) : 0,
      },
      null,
      2,
    ),
    "utf8",
  )
}

function compactStrings(values: unknown[]): string[] {
  const out: string[] = []
  for (const value of values) {
    const normalized = String(value ?? "").trim()
    if (normalized) out.push(normalized)
  }
  return out
}

function parseInlineFrontmatterArray(value: string): string[] {
  const trimmed = String(value || "").trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return []
  try {
    const parsed = JSON.parse(trimmed.replace(/'/g, "\"")) as unknown
    if (!Array.isArray(parsed)) return []
    return compactStrings(parsed)
  } catch {
    return []
  }
}

function parseMetadataReadWhenInline(value: string): string[] {
  const trimmed = String(value || "").trim()
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return []
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const raw = parsed?.read_when
    if (!Array.isArray(raw)) return []
    return compactStrings(raw)
  } catch {
    return []
  }
}

function extractSkillMetadataFromFrontmatter(content: string): { description: string; readWhen: string[] } {
  const normalized = content.replace(/\r\n/g, "\n")
  const match = normalized.match(/^---\n([\s\S]*?)\n---/m)
  if (!match) return { description: "No description provided.", readWhen: [] }
  const frontmatter = match[1] || ""
  const lines = frontmatter.split("\n")
  let description = "No description provided."
  const readWhen: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i] || ""
    const indent = rawLine.length - rawLine.trimStart().length
    const line = rawLine.trim()
    if (!line) continue
    if (indent > 0) continue

    if (/^description\s*:/i.test(line)) {
      description = line.replace(/^description\s*:/i, "").trim().replace(/^['"]|['"]$/g, "") || "No description provided."
      continue
    }
    if (/^metadata\s*:/i.test(line)) {
      const inline = line.replace(/^metadata\s*:/i, "").trim()
      if (inline) {
        readWhen.push(...parseMetadataReadWhenInline(inline))
      }

      let inMetadataReadWhen = false
      let readWhenIndent = -1
      for (let j = i + 1; j < lines.length; j += 1) {
        const nextRaw = lines[j] || ""
        const nextTrimmed = nextRaw.trim()
        if (!nextTrimmed) continue
        const nextIndent = nextRaw.length - nextRaw.trimStart().length
        if (nextIndent <= indent) {
          i = j - 1
          break
        }
        if (/^read_when\s*:/i.test(nextTrimmed)) {
          inMetadataReadWhen = true
          readWhenIndent = nextIndent
          readWhen.push(
            ...parseInlineFrontmatterArray(nextTrimmed.replace(/^read_when\s*:/i, "").trim()),
          )
          continue
        }
        if (inMetadataReadWhen && nextIndent > readWhenIndent && nextTrimmed.startsWith("- ")) {
          const hint = nextTrimmed.slice(2).trim()
          if (hint) readWhen.push(hint)
          continue
        }
        if (inMetadataReadWhen && nextIndent <= readWhenIndent) {
          inMetadataReadWhen = false
        }
      }
      continue
    }

    // Backward compatibility for older local skills using top-level read_when.
    if (/^read_when\s*:/i.test(line)) {
      readWhen.push(...parseInlineFrontmatterArray(line.replace(/^read_when\s*:/i, "").trim()))
      for (let j = i + 1; j < lines.length; j += 1) {
        const nextRaw = lines[j] || ""
        const nextTrimmed = nextRaw.trim()
        if (!nextTrimmed) continue
        const nextIndent = nextRaw.length - nextRaw.trimStart().length
        if (nextIndent <= indent) {
          i = j - 1
          break
        }
        if (nextTrimmed.startsWith("- ")) {
          const hint = nextTrimmed.slice(2).trim()
          if (hint) readWhen.push(hint)
          continue
        }
        if (nextIndent <= indent + 1) {
          i = j - 1
          break
        }
      }
      continue
    }
  }
  return {
    description,
    readWhen: Array.from(new Set(compactStrings(readWhen))),
  }
}

function parseFrontmatter(content: string): { map: Record<string, string>; body: string } | null {
  const normalized = content.replace(/\r\n/g, "\n")
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return null
  const frontmatterRaw = match[1] || ""
  const body = match[2] || ""
  const map: Record<string, string> = {}
  for (const rawLine of frontmatterRaw.split("\n")) {
    // Nested metadata lines are not top-level frontmatter keys.
    if (/^\s/.test(rawLine)) continue
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
  const hasRequiredKeys = uniqueKeys.includes("name") && uniqueKeys.includes("description")
  const hasOnlySupportedKeys = uniqueKeys.every((key) => SUPPORTED_FRONTMATTER_KEYS.has(key))
  if (!hasRequiredKeys || !hasOnlySupportedKeys) {
    errors.push(
      "Frontmatter must include `name` and `description`, and only supported keys (`argument-hint`, `compatibility`, `disable-model-invocation`, `license`, `metadata`, `user-invokable`).",
    )
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
  options?: { onlyWhenEmpty?: boolean; respectDisabled?: boolean; markInitialized?: boolean },
): Promise<string[]> {
  const skillsDir = resolveSkillsDir(workspaceRoot, userId)
  await mkdir(skillsDir, { recursive: true })
  const meta = await readSkillMeta(workspaceRoot, userId)
  const respectDisabled = options?.respectDisabled !== false
  const disabled = new Set(meta.disabledStarters)
  let metaChanged = false

  if (options?.onlyWhenEmpty) {
    const existingSkills = await listSkillSummaries(skillsDir)
    if (existingSkills.length > 0) return []
  }

  const installed: string[] = []
  for (const starter of STARTER_SKILLS) {
    if (respectDisabled && disabled.has(starter.name)) {
      continue
    }
    if (!respectDisabled && disabled.has(starter.name)) {
      disabled.delete(starter.name)
      metaChanged = true
    }

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

  if (options?.markInitialized && !meta.startersInitialized) {
    meta.startersInitialized = true
    metaChanged = true
  }
  if (options?.markInitialized && meta.catalogVersion < STARTER_SKILLS_CATALOG_VERSION) {
    meta.catalogVersion = STARTER_SKILLS_CATALOG_VERSION
    metaChanged = true
  }
  if (metaChanged) {
    await writeSkillMeta(workspaceRoot, userId, {
      startersInitialized: meta.startersInitialized,
      disabledStarters: Array.from(disabled),
      catalogVersion: meta.catalogVersion,
    })
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
    const metadata = extractSkillMetadataFromFrontmatter(content)
    summaries.push({
      name,
      description: metadata.description,
      readWhen: metadata.readWhen,
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

    const meta = await readSkillMeta(workspaceRoot, verified.user.id)
    const shouldSeedStarters =
      !meta.startersInitialized || meta.catalogVersion < STARTER_SKILLS_CATALOG_VERSION
    const seeded = shouldSeedStarters
      ? await installStarterSkills(workspaceRoot, verified.user.id, {
          onlyWhenEmpty: false,
          respectDisabled: true,
          markInitialized: true,
        })
      : []
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
      const installed = await installStarterSkills(workspaceRoot, verified.user.id, {
        onlyWhenEmpty: false,
        respectDisabled: false,
        markInitialized: true,
      })
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

export async function DELETE(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const workspaceRoot = path.resolve(process.cwd(), "..")
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

    const skills = await listSkillSummaries(resolveSkillsDir(workspaceRoot, verified.user.id))
    return NextResponse.json({ ok: true, deleted: name, skills })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to delete skill." },
      { status: 500 },
    )
  }
}
