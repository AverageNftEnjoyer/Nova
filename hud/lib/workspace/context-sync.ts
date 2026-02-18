import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const MANAGED_START = "<!-- NOVA_SETTINGS_SYNC:START -->"
const MANAGED_END = "<!-- NOVA_SETTINGS_SYNC:END -->"

export interface WorkspaceContextSyncInput {
  assistantName?: string
  userName?: string
  nickname?: string
  occupation?: string
  preferredLanguage?: string
  communicationStyle?: string
  tone?: string
  characteristics?: string
  customInstructions?: string
  interests?: string[]
}

export interface WorkspaceContextSyncResult {
  userContextDir: string
  updatedFiles: string[]
}

type SyncedTone = "neutral" | "enthusiastic" | "calm" | "direct" | "relaxed"

function normalizeTone(value: unknown): SyncedTone {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "enthusiastic") return "enthusiastic"
  if (normalized === "calm") return "calm"
  if (normalized === "direct") return "direct"
  if (normalized === "relaxed") return "relaxed"
  return "neutral"
}

function toneDirective(tone: SyncedTone): string {
  if (tone === "enthusiastic") {
    return "Use energetic, motivating language with positive momentum while staying precise."
  }
  if (tone === "calm") {
    return "Use steady, reassuring language with low urgency and clear, measured pacing."
  }
  if (tone === "direct") {
    return "Use concise, action-first language with minimal filler and explicit next steps."
  }
  if (tone === "relaxed") {
    return "Use casual, easygoing language that stays clear and practical without sounding rushed."
  }
  return "Use balanced, neutral language that is clear, practical, and professional."
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

function resolveUserContextDir(workspaceRoot: string, userId: string): string {
  return path.join(path.resolve(workspaceRoot), ".agent", "user-context", sanitizeUserContextId(userId))
}

function compactText(value: unknown, maxLen: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen)
}

function compactList(values: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => compactText(value, maxLen))
    .filter(Boolean)
    .slice(0, maxItems)
}

function injectManagedBlock(existingRaw: string, fallbackHeader: string, block: string): string {
  const existing = String(existingRaw ?? "")
  const managedBlock = `${MANAGED_START}\n${block.trim()}\n${MANAGED_END}`
  const start = existing.indexOf(MANAGED_START)
  const end = existing.indexOf(MANAGED_END)

  if (start >= 0 && end > start) {
    const before = existing.slice(0, start).trimEnd()
    return `${before}\n\n${managedBlock}\n`
  }

  const base = existing.trim()
  if (!base) {
    return `${fallbackHeader}\n\n${managedBlock}\n`
  }
  return `${base}\n\n${managedBlock}\n`
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return ""
  }
}

async function upsertManagedMarkdown(
  filePath: string,
  fallbackHeader: string,
  block: string,
  updatedFiles: string[],
): Promise<void> {
  const existing = await readTextFile(filePath)
  const next = injectManagedBlock(existing, fallbackHeader, block)
  if (existing === next) return
  await writeFile(filePath, next, "utf8")
  updatedFiles.push(filePath)
}

export async function syncWorkspaceContextFiles(
  workspaceRoot: string,
  userId: string,
  rawInput: WorkspaceContextSyncInput,
): Promise<WorkspaceContextSyncResult> {
  const userContextDir = resolveUserContextDir(workspaceRoot, userId)
  await mkdir(userContextDir, { recursive: true })

  const resolvedTone = normalizeTone(rawInput.tone || "neutral")
  const input: WorkspaceContextSyncInput = {
    assistantName: compactText(rawInput.assistantName || "Nova", 60) || "Nova",
    userName: compactText(rawInput.userName || "User", 80) || "User",
    nickname: compactText(rawInput.nickname, 80),
    occupation: compactText(rawInput.occupation, 120),
    preferredLanguage: compactText(rawInput.preferredLanguage || "English", 80) || "English",
    communicationStyle: compactText(rawInput.communicationStyle || "friendly", 60) || "friendly",
    tone: resolvedTone,
    characteristics: compactText(rawInput.characteristics, 240),
    customInstructions: compactText(rawInput.customInstructions, 320),
    interests: compactList(rawInput.interests, 6, 48),
  }

  const today = new Date().toISOString().slice(0, 10)
  const updatedFiles: string[] = []

  const userBlock = [
    "## Synced From Nova Settings",
    "",
    `- Assistant name: ${input.assistantName}`,
    `- Name: ${input.userName}`,
    input.nickname ? `- Nickname: ${input.nickname}` : "",
    input.occupation ? `- Occupation: ${input.occupation}` : "",
    `- Preferred language: ${input.preferredLanguage}`,
    `- Communication style: ${input.communicationStyle}`,
    `- Tone: ${input.tone}`,
    input.characteristics ? `- Characteristics: ${input.characteristics}` : "",
    input.interests && input.interests.length > 0 ? `- Interests: ${input.interests.join(", ")}` : "",
    "",
    "### Active Custom Instructions",
    input.customInstructions || "- (none set)",
  ]
    .filter(Boolean)
    .join("\n")

  const soulBlock = [
    "## Runtime Persona Overrides",
    "",
    `- Assistant display name: ${input.assistantName}`,
    `- Primary user: ${input.userName}`,
    `- Default tone: ${input.tone}`,
    `- Tone directive: ${toneDirective(resolvedTone)}`,
    `- Communication style: ${input.communicationStyle}`,
    input.customInstructions ? `- Priority behavior note: ${input.customInstructions}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  const agentsBlock = [
    "## Runtime Instruction Overlay",
    "",
    "When user-specific instructions are present, apply them unless they conflict with safety constraints.",
    `- User: ${input.userName}`,
    `- Preferred language: ${input.preferredLanguage}`,
    `- Enforced tone behavior: ${toneDirective(resolvedTone)}`,
    input.occupation ? `- Occupation context: ${input.occupation}` : "",
    input.customInstructions ? `- Custom instructions: ${input.customInstructions}` : "- Custom instructions: none",
  ]
    .filter(Boolean)
    .join("\n")

  const memoryBlock = [
    "## Runtime Snapshot (Auto-Synced)",
    "",
    `${today}: Assistant name set to "${input.assistantName}".`,
    `${today}: User name "${input.userName}" with communication style "${input.communicationStyle}" and tone "${input.tone}".`,
    input.occupation ? `${today}: Occupation context "${input.occupation}".` : "",
    input.customInstructions ? `${today}: Active custom instructions captured from settings.` : "",
  ]
    .filter(Boolean)
    .join("\n")

  const identityBlock = `${input.assistantName} is a personal AI assistant serving ${input.userName}. It provides direct, practical help with coding, research, workspace tasks, and context continuity. Default communication style is ${input.communicationStyle} with a ${input.tone} tone, and it should follow current user-specific instructions while staying accurate and safe.`

  await upsertManagedMarkdown(path.join(userContextDir, "USER.md"), "# USER", userBlock, updatedFiles)
  await upsertManagedMarkdown(path.join(userContextDir, "SOUL.md"), "# SOUL", soulBlock, updatedFiles)
  await upsertManagedMarkdown(path.join(userContextDir, "AGENTS.md"), "# AGENTS", agentsBlock, updatedFiles)
  await upsertManagedMarkdown(path.join(userContextDir, "MEMORY.md"), "# Persistent Memory", memoryBlock, updatedFiles)
  await upsertManagedMarkdown(path.join(userContextDir, "IDENTITY.md"), "# Identity", identityBlock, updatedFiles)

  return { userContextDir, updatedFiles }
}
