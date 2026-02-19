import "server-only"

import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

const DEFAULT_MAX_SKILLS = Math.max(
  1,
  Math.min(24, Number.parseInt(process.env.NOVA_MISSION_SKILL_SNAPSHOT_MAX_SKILLS || "10", 10) || 10),
)
const DEFAULT_MAX_GUIDANCE_CHARS = Math.max(
  600,
  Math.min(12_000, Number.parseInt(process.env.NOVA_MISSION_SKILL_SNAPSHOT_MAX_CHARS || "3600", 10) || 3600),
)

export interface MissionSkillSnapshot {
  version: string
  createdAt: string
  skillCount: number
  guidance: string
}

interface SkillDoc {
  name: string
  description: string
  readWhen: string[]
  content: string
  filePath: string
  mtimeMs: number
  size: number
}

function sanitizeUserContextId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

function compactText(value: unknown, maxChars: number): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trim()}...`
}

function extractFrontmatter(content: string): string {
  const normalized = String(content || "").replace(/\r\n/g, "\n").trim()
  if (!normalized.startsWith("---")) return ""
  const end = normalized.indexOf("\n---", 3)
  if (end <= 0) return ""
  return normalized.slice(3, end)
}

function extractFrontmatterArray(frontmatter: string, key: string): string[] {
  const pattern = new RegExp(`["']?${key}["']?\\s*:\\s*\\[([^\\]]*)\\]`, "i")
  const match = String(frontmatter || "").match(pattern)
  if (!match?.[1]) return []
  return Array.from(
    new Set(
      match[1]
        .split(",")
        .map((item) => String(item || "").trim().replace(/^['"`]|['"`]$/g, ""))
        .filter(Boolean),
    ),
  )
}

function extractMetadata(content: string): { description: string; readWhen: string[] } {
  const frontmatter = extractFrontmatter(content)
  if (!frontmatter) {
    return {
      description: "No description provided.",
      readWhen: [],
    }
  }
  const descMatch = frontmatter.match(/^\s*description\s*:\s*(.+)$/im)
  const description = descMatch?.[1]
    ? String(descMatch[1]).trim().replace(/^['"]|['"]$/g, "")
    : "No description provided."
  const readWhen = extractFrontmatterArray(frontmatter, "read_when")
  return { description, readWhen }
}

async function walkSkillFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkSkillFiles(fullPath)))
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      files.push(fullPath)
    }
  }
  return files
}

async function discoverMissionSkills(dirs: string[]): Promise<SkillDoc[]> {
  const byName = new Map<string, SkillDoc>()
  for (const dir of dirs) {
    if (!dir) continue
    const files = await walkSkillFiles(dir)
    for (const filePath of files) {
      const raw = await readFile(filePath, "utf8").catch(() => "")
      if (!raw.trim()) continue
      const fileStat = await stat(filePath).catch(() => null)
      const name = path.basename(path.dirname(filePath)).trim().toLowerCase()
      if (!name) continue
      const metadata = extractMetadata(raw)
      byName.set(name, {
        name,
        description: metadata.description,
        readWhen: metadata.readWhen,
        content: raw.replace(/\r\n/g, "\n").trim(),
        filePath,
        mtimeMs: fileStat ? Number(fileStat.mtimeMs || 0) : 0,
        size: fileStat ? Number(fileStat.size || 0) : 0,
      })
    }
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function buildGuidance(skills: SkillDoc[], maxChars: number): string {
  if (!skills.length) return ""
  const header = [
    "Stable skill guidance for this mission run:",
    "- Apply relevant domain rules from these skills where they improve correctness.",
    "- Do not invent behavior outside provided workflow data.",
    "",
  ].join("\n")
  let out = header
  for (const skill of skills) {
    const chunk = [
      `Skill: ${skill.name}`,
      `Description: ${compactText(skill.description, 220)}`,
      skill.readWhen.length > 0 ? `Read-when: ${compactText(skill.readWhen.join(" | "), 260)}` : "",
      `Core: ${compactText(skill.content.replace(/^---[\s\S]*?---/m, "").trim(), 520)}`,
      "",
    ]
      .filter(Boolean)
      .join("\n")
    if ((out + chunk).length > maxChars) break
    out += chunk
  }
  return compactText(out.trim(), maxChars)
}

function buildVersion(skills: SkillDoc[]): string {
  const payload = skills
    .map((skill) => `${skill.name}:${skill.filePath}:${skill.mtimeMs}:${skill.size}`)
    .join("|")
  return createHash("sha256").update(payload || "empty", "utf8").digest("hex")
}

export async function loadMissionSkillSnapshot(params?: {
  userId?: string
  maxSkills?: number
  maxChars?: number
}): Promise<MissionSkillSnapshot> {
  const workspaceRoot = path.resolve(process.cwd(), "..")
  const scopedUserId = sanitizeUserContextId(params?.userId || "")
  const dirs = [path.join(workspaceRoot, "skills")]
  if (scopedUserId) {
    dirs.push(path.join(workspaceRoot, ".agent", "user-context", scopedUserId, "skills"))
  }

  const skills = await discoverMissionSkills(dirs)
  const maxSkills = Number.isFinite(Number(params?.maxSkills || 0))
    ? Math.max(1, Number(params?.maxSkills || 0))
    : DEFAULT_MAX_SKILLS
  const maxChars = Number.isFinite(Number(params?.maxChars || 0))
    ? Math.max(600, Number(params?.maxChars || 0))
    : DEFAULT_MAX_GUIDANCE_CHARS
  const selected = skills.slice(0, maxSkills)

  return {
    version: buildVersion(selected),
    createdAt: new Date().toISOString(),
    skillCount: selected.length,
    guidance: buildGuidance(selected, maxChars),
  }
}
