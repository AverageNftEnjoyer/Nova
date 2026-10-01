/**
 * Reads the real activity behind Nova City from nova.db and the user's workspace skills.
 *
 * A handful of user-scoped queries, each on a primary key prefix or an index. Free of `server-only` and `@/` runtime
 * imports so scripts/smoke/town can transpile and run it against a scratch nova.db.
 */

import fs from "node:fs"
import path from "node:path"
import { getDb } from "../../../src/db/index.js"
import { zonedDateKey, zonedDayStartMs } from "../analytics/time-zone"
import { INTEGRATION_SETUP_KEYS, type IntegrationSetupKey } from "../integrations/navigation"
import { STARTER_SKILL_NAMES, resolveSkillsDir } from "../workspace/skills/service"
import type { TownLifetimeCounts, TownTodayCounts } from "./rules"

export interface TownActivity {
  counts: TownLifetimeCounts
  today: TownTodayCounts
  dayKey: string
  /** Uses per integration: tool runs by tool-name prefix, LLM calls by provider, succeeded mission runs by node type. */
  uses: Record<IntegrationSetupKey, number>
}

const SKILL_FILE_NAME = "SKILL.md"

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

/** The integration a tool belongs to, from its registry name; null for built-in tools (read, exec, memory, ...). */
export function integrationForToolName(toolName: string): IntegrationSetupKey | null {
  const name = String(toolName || "").trim().toLowerCase()
  if (!name) return null
  if (name.startsWith("gmail_")) return "gmail"
  if (name.includes("calendar")) return "gmail-calendar"
  if (name.startsWith("coinbase_")) return "coinbase"
  if (name.startsWith("phantom_")) return "phantom"
  if (name.startsWith("polymarket")) return "polymarket"
  if (name.startsWith("spotify")) return "spotify"
  if (name.startsWith("youtube")) return "youtube"
  if (name.startsWith("telegram")) return "telegram"
  if (name.startsWith("discord")) return "discord"
  if (name.startsWith("slack")) return "slack"
  if (name.startsWith("news")) return "news"
  // web_search is served by Brave Search (src/tools/web/web-search).
  if (name === "web_search" || name.startsWith("brave")) return "brave"
  return null
}

/** llm_usage.provider → the AI lab it powers. */
export function integrationForProvider(provider: string): IntegrationSetupKey | null {
  const value = String(provider || "").trim().toLowerCase()
  if (value === "openai") return "openai"
  if (value === "claude" || value === "anthropic") return "claude"
  if (value === "grok" || value === "xai") return "grok"
  if (value === "gemini" || value === "google") return "gemini"
  return null
}

/** Mission node types (hud/lib/missions/types) that use an integration; a succeeded run counts one use for each. */
const MISSION_NODE_INTEGRATIONS: readonly { nodeType: string; integration: IntegrationSetupKey }[] = [
  { nodeType: "telegram-output", integration: "telegram" },
  { nodeType: "discord-output", integration: "discord" },
  { nodeType: "slack-output", integration: "slack" },
  { nodeType: "email-output", integration: "gmail" },
  { nodeType: "coinbase", integration: "coinbase" },
  { nodeType: "polymarket-data-fetch", integration: "polymarket" },
  { nodeType: "polymarket-monitor", integration: "polymarket" },
  { nodeType: "polymarket-price-trigger", integration: "polymarket" },
  { nodeType: "web-search", integration: "brave" },
]

const MISSION_USES_SQL = `SELECT ${MISSION_NODE_INTEGRATIONS.map(
  (entry, index) => `instr(m.data_json, '"type":"${entry.nodeType}"') > 0 AS n${index}`,
).join(", ")},
        (SELECT COUNT(*) FROM job_runs jr WHERE jr.user_id = m.user_id AND jr.mission_id = m.id AND jr.status = 'succeeded') AS runs
   FROM missions m
  WHERE m.user_id = ?`

function countSkills(userId: string): number {
  let dir: string
  try {
    dir = resolveSkillsDir("", userId)
  } catch {
    return 0
  }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let count = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || STARTER_SKILL_NAMES.has(entry.name)) continue
    if (fs.existsSync(path.join(dir, entry.name, SKILL_FILE_NAME))) count += 1
  }
  return count
}

/** Reads lifetime + today counts and per-integration uses for one user. `timeZone` sets "today". */
export function readTownActivity(userId: string, timeZone: string, now: Date = new Date()): TownActivity {
  const db = getDb()
  const one = (sql: string, ...params: unknown[]): number => {
    const row = db.prepare(sql).get(...params) as { n?: unknown } | undefined
    return num(row?.n)
  }

  const dayKey = zonedDateKey(now.getTime(), timeZone)
  const dayStartMs = zonedDayStartMs(dayKey, timeZone)
  const dayStartIso = new Date(dayStartMs).toISOString()

  const task = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(completed_at >= ?), 0) AS today
         FROM agent_tasks WHERE user_id = ? AND status = 'completed'`,
    )
    .get(dayStartIso, userId) as { n: number; today: number }

  const deployRuns = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM deployment_runs WHERE user_id = ? AND status = 'succeeded'`,
    )
    .get(userId) as { n: number }

  // Chat messages live in `messages` (HUD threads) and in `session_turns` (runtime transcript). Both record the same
  // turns, so the larger count is used rather than their sum.
  const messages = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(created_at >= ?), 0) AS today
         FROM messages WHERE user_id = ? AND role = 'user'`,
    )
    .get(dayStartIso, userId) as { n: number; today: number }
  const turns = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(ts >= ?), 0) AS today
         FROM session_turns WHERE user_id = ? AND role = 'user'`,
    )
    .get(dayStartMs, userId) as { n: number; today: number }

  const notes = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(updated_at >= ?), 0) AS today FROM notes WHERE user_id = ?`)
    .get(dayStartIso, userId) as { n: number; today: number }

  const uses = Object.fromEntries(INTEGRATION_SETUP_KEYS.map((key) => [key, 0])) as Record<IntegrationSetupKey, number>

  let toolRuns = 0
  let toolRunsToday = 0
  const toolRows = db
    .prepare(
      `SELECT tool_name, COUNT(*) AS n, COALESCE(SUM(created_at >= ?), 0) AS today
         FROM tool_runs WHERE user_id = ? AND status = 'success' GROUP BY tool_name`,
    )
    .all(dayStartIso, userId) as { tool_name: string; n: number; today: number }[]
  for (const row of toolRows) {
    toolRuns += num(row.n)
    toolRunsToday += num(row.today)
    const key = integrationForToolName(row.tool_name)
    if (key) uses[key] += num(row.n)
  }

  let llmCalls = 0
  const providerRows = db
    .prepare(`SELECT provider, COUNT(*) AS n FROM llm_usage WHERE user_id = ? GROUP BY provider`)
    .all(userId) as { provider: string; n: number }[]
  for (const row of providerRows) {
    llmCalls += num(row.n)
    const key = integrationForProvider(row.provider)
    if (key) uses[key] += num(row.n)
  }

  const missionRows = db.prepare(MISSION_USES_SQL).all(userId) as Record<string, number>[]
  for (const row of missionRows) {
    const runs = num(row.runs)
    if (runs === 0) continue
    const seen = new Set<IntegrationSetupKey>()
    MISSION_NODE_INTEGRATIONS.forEach((entry, index) => {
      if (num(row[`n${index}`]) > 0 && !seen.has(entry.integration)) {
        seen.add(entry.integration)
        uses[entry.integration] += runs
      }
    })
  }

  const counts: TownLifetimeCounts = {
    tasksCompleted: num(task.n),
    deployments: one(`SELECT COUNT(*) AS n FROM deployments WHERE user_id = ?`, userId),
    deploymentRunsSucceeded: num(deployRuns.n),
    // A deployment's Mission-backed definition counts as the deployment, not again as a mission.
    missions: one(
      `SELECT COUNT(*) AS n FROM missions m
        WHERE m.user_id = ?
          AND NOT EXISTS (SELECT 1 FROM deployments d WHERE d.user_id = m.user_id AND d.mission_id = m.id)`,
      userId,
    ),
    // A job run that is a deployment run's attempt counts as the deployment run.
    missionRunsSucceeded: one(
      `SELECT COUNT(*) AS n FROM job_runs jr
        WHERE jr.user_id = ? AND jr.status = 'succeeded'
          AND NOT EXISTS (SELECT 1 FROM deployment_runs dr WHERE dr.job_run_id = jr.id)`,
      userId,
    ),
    notes: num(notes.n),
    conversations: one(`SELECT COUNT(*) AS n FROM threads WHERE user_id = ?`, userId),
    chatMessages: Math.max(num(messages.n), num(turns.n)),
    toolRuns,
    skills: countSkills(userId),
    llmCalls,
  }

  const today: TownTodayCounts = {
    chatMessages: Math.max(num(messages.today), num(turns.today)),
    tasksCompleted: num(task.today),
    notesTouched: num(notes.today),
    toolRuns: toolRunsToday,
  }

  return { counts, today, dayKey, uses }
}
