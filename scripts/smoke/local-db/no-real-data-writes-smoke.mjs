/**
 * Guard: the smoke suite must never write to the user's real Nova data.
 *
 * Opens the real nova.db READ-ONLY (skipped if it does not exist), snapshots the row count of every table, runs a
 * representative set of the other smokes in child processes - with NOVA_DATA_DIR / NOVA_PACKAGED removed from their
 * environment so each one has to isolate itself (scripts/smoke/lib/isolated-data-dir.mjs) - and fails if any count
 * changed or if a child failed.
 *
 * The real databases checked are the ones a smoke could hit by accident:
 *   - <repo>/.user/nova.db                  (dev layout)
 *   - %APPDATA%/Nova/nova.db                (packaged layout)
 *
 * It also compares the set of file/directory paths under the real data dir (names only, so appends by a running app
 * are ignored but a smoke creating e.g. user-context/<test-user>/ is caught).
 *
 * Caveat: if the real app is running while this guard runs, its own writes can change the counts. Close it first.
 * This script never writes to, or deletes anything from, either location.
 */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

const REPRESENTATIVE_SMOKES = [
  "scripts/smoke/audit/p1-it-word-regression/smoke.mjs",
  "scripts/smoke/audit/p2-rule-newline/smoke.mjs",
  "scripts/smoke/audit/p5-workspace-write/smoke.mjs",
  "scripts/smoke/audit/p6-skills-depth/smoke.mjs",
  "scripts/smoke/audit/skills-apostrophe/smoke.mjs",
  "scripts/smoke/audit/starter-seeding/smoke.mjs",
  "scripts/smoke/routing/src-policy-approval-store-smoke.mjs",
  "scripts/smoke/routing/src-short-term-context-persistence-smoke.mjs",
  "scripts/smoke/routing/src-tool-runtime-bootstrap-smoke.mjs",
  "scripts/smoke/missions/src-mission-persistence-smoke.mjs",
  "scripts/smoke/scheduler/src-scheduler-skills-snapshot-smoke.mjs",
  "scripts/smoke/hud/hud-thread-delete-transcript-smoke.mjs",
  "scripts/smoke/runtime/spotify-user-context-isolation-smoke.mjs",
  "scripts/smoke/local-db/tool-runs-smoke.mjs",
  "scripts/smoke/local-db/data-paths-smoke.mjs",
]

function realDbCandidates() {
  const list = [path.join(repoRoot, ".user", "nova.db")]
  const appData = String(process.env.APPDATA || "").trim() || path.join(os.homedir(), "AppData", "Roaming")
  list.push(path.join(appData, "Nova", "nova.db"))
  return list.filter((file, index, all) => all.indexOf(file) === index && fs.existsSync(file))
}

/** Row count per table plus max(rowid), read-only. */
function snapshot(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const out = {}
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
    for (const { name } of tables) {
      const quoted = `"${String(name).replace(/"/g, '""')}"`
      let row
      try {
        row = db.prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(rowid), 0) AS m FROM ${quoted}`).get()
      } catch {
        // WITHOUT ROWID table
        row = { ...db.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get(), m: 0 }
      }
      out[name] = `${row.n}/${row.m}`
    }
    return out
  } finally {
    db.close()
  }
}

/** Relative paths of every file/dir under `dir` (names only; nova.db* excluded, they are covered by the row counts). */
function treePaths(dir) {
  const out = new Set()
  const walk = (current) => {
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (/^nova\.db(-wal|-shm)?$/.test(entry.name)) continue
      const full = path.join(current, entry.name)
      out.add(path.relative(dir, full))
      if (entry.isDirectory()) walk(full)
    }
  }
  walk(dir)
  return out
}

const targets = realDbCandidates()
if (targets.length === 0) {
  console.log("SKIP no-real-data-writes: no real nova.db present (nothing to protect).")
  process.exit(0)
}

const before = new Map(targets.map((file) => [file, snapshot(file)]))
const beforeTrees = new Map(targets.map((file) => [file, treePaths(path.dirname(file))]))

const childEnv = { ...process.env }
delete childEnv.NOVA_DATA_DIR
delete childEnv.NOVA_PACKAGED

const failures = []
let ran = 0
for (const relative of REPRESENTATIVE_SMOKES) {
  const script = path.join(repoRoot, relative)
  if (!fs.existsSync(script)) {
    failures.push(`missing smoke script: ${relative}`)
    continue
  }
  const result = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    env: childEnv,
    encoding: "utf8",
    timeout: 180_000,
    windowsHide: true,
  })
  ran += 1
  const ok = result.status === 0
  console.log(`${ok ? "PASS" : "FAIL"} child ${relative}`)
  if (!ok) failures.push(`child failed (exit ${result.status}): ${relative}\n${String(result.stdout || "").slice(-400)}${String(result.stderr || "").slice(-400)}`)
}

for (const file of targets) {
  const after = snapshot(file)
  const prior = before.get(file)
  const names = [...new Set([...Object.keys(prior), ...Object.keys(after)])].sort()
  for (const name of names) {
    if (prior[name] !== after[name]) {
      failures.push(`${file}: table ${name} changed ${prior[name] ?? "(absent)"} -> ${after[name] ?? "(absent)"}`)
    }
  }
}

for (const file of targets) {
  const afterTree = treePaths(path.dirname(file))
  const added = [...afterTree].filter((entry) => !beforeTrees.get(file).has(entry))
  if (added.length > 0) failures.push(`${path.dirname(file)}: new paths appeared: ${added.slice(0, 10).join(", ")}`)
}

if (failures.length > 0) {
  console.error(`FAIL no-real-data-writes: ${failures.length} problem(s)`)
  for (const line of failures) console.error(` - ${line}`)
  process.exit(1)
}
assert.ok(ran > 0)
console.log(`PASS no-real-data-writes: ${ran} smokes ran, ${targets.length} real db(s) unchanged (${targets.join(", ")})`)
