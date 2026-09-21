/**
 * Data-path convergence: every runtime/HUD location that holds per-user files must follow resolveDataDir()
 * (NOVA_DATA_DIR / packaged / <repo>/.user), i.e. live next to nova.db, and never under process.cwd()/.user or the
 * repo when the data dir is overridden. Runs against a throwaway NOVA_DATA_DIR.
 */
import { isolatedDataDir } from "../lib/isolated-data-dir.mjs" // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const url = (relative) => pathToFileURL(path.join(repoRoot, relative)).href
const results = []
async function run(name, fn) {
  try {
    await fn()
    results.push({ status: "PASS", name })
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.message : String(error) })
  }
}
const under = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
}

const paths = await import(url("src/db/paths.js"))
const constants = await import(url("src/runtime/core/constants/index.js"))
const runtime = await import(url("src/providers/runtime/runtime.js"))
const audit = await import(url("hud/lib/server/thread-delete-audit/index.js"))
const identity = await import(url("src/runtime/modules/context/identity/constants/index.js"))

await run("resolveUserContextRoot is <dataDir>/user-context", () => {
  assert.equal(paths.resolveUserContextRoot(), path.join(isolatedDataDir, "user-context"))
})

await run("runtime constants (USER_CONTEXT_ROOT, MEMORY_DB_PATH, session paths) follow the data dir", () => {
  assert.equal(constants.USER_CONTEXT_ROOT, path.join(isolatedDataDir, "user-context"))
  assert.equal(constants.MEMORY_DB_PATH, path.join(isolatedDataDir, "memory.db"))
  assert.ok(under(constants.SESSION_STORE_PATH, isolatedDataDir))
  assert.ok(under(constants.SESSION_TRANSCRIPT_DIR, isolatedDataDir))
})

await run("identity module and provider runtime paths follow the data dir", () => {
  assert.equal(identity.resolveDefaultIdentityRoot(), path.join(isolatedDataDir, "user-context"))
  const runtimePaths = runtime.resolveRuntimePaths(repoRoot)
  assert.equal(runtimePaths.userContextRoot, path.join(isolatedDataDir, "user-context"))
})

await run("thread-delete audit logs are written under the data dir, not the workspace root", async () => {
  const uid = `data-paths-${Date.now()}`
  const workspaceRoot = path.join(isolatedDataDir, "..", "definitely-not-the-data-dir")
  const result = await audit.appendThreadDeleteAuditLog({
    workspaceRoot,
    userContextId: uid,
    threadId: "t-1",
    removedTranscriptFiles: 0,
    threadMessageCount: 2,
  })
  assert.equal(result.alertTriggered, true)
  const auditLog = path.join(isolatedDataDir, "user-context", uid, "logs", "thread-delete-audit.jsonl")
  const alertLog = path.join(isolatedDataDir, "user-context", uid, "logs", "thread-delete-alerts.jsonl")
  assert.ok(fs.existsSync(auditLog), `missing ${auditLog}`)
  assert.ok(fs.existsSync(alertLog), `missing ${alertLog}`)
  assert.ok(!fs.existsSync(path.join(workspaceRoot, ".user")), "workspaceRoot/.user must not be created")
  assert.ok(!fs.existsSync(path.join(repoRoot, ".user", "user-context", uid)), "repo .user must not be touched")
})

await run("no code under src/ or hud/ (excluding history docs) still hardcodes <root>/.user/user-context", () => {
  const offenders = []
  // Owned by the dev-logs work stream (its reader still derives <workspaceRoot>/.user itself); drop this entry once migrated.
  const pendingElsewhere = new Set(["hud/app/api/dev-logs/route.ts"])
  const roots = ["src", "hud/lib", "hud/app"]
  const skip = new Set(["node_modules", ".next", "dist"])
  const needle = /["'`]\.user["'`]\s*,\s*["'`]user-context["'`]/
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(js|mjs|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        const relative = path.relative(repoRoot, full).split(path.sep).join("/")
        if (needle.test(fs.readFileSync(full, "utf8"))) {
          if (pendingElsewhere.has(relative)) console.log(`NOTE still pending (other work stream): ${relative}`)
          else offenders.push(relative)
        }
      }
    }
  }
  for (const root of roots) walk(path.join(repoRoot, root))
  assert.deepEqual(offenders, [], `hardcoded .user/user-context found in: ${offenders.join(", ")}`)
})

let failed = 0
for (const r of results) {
  console.log(`${r.status} ${r.name}${r.detail ? `\n  ${r.detail}` : ""}`)
  if (r.status === "FAIL") failed += 1
}
console.log(`Summary: pass=${results.length - failed} fail=${failed}`)
process.exit(failed ? 1 : 0)
