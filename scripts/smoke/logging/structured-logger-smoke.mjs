/**
 * Structured Logger Smoke Test
 * Static analysis verification for hud/lib/logging/structured-logger.ts
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const results = []

function record(status, name, detail = "") {
  results.push({ status, name, detail })
}

async function run(name, fn) {
  try {
    await fn()
    record("PASS", name)
  } catch (error) {
    record("FAIL", name, error instanceof Error ? error.message : String(error))
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const loggerSource = read("hud/lib/logging/structured-logger.ts")
const sanitizerSource = read("hud/lib/missions/telemetry/sanitizer.ts")

await run("SL-1 structured-logger exports log function", () => {
  assert.ok(loggerSource.includes("export function log("))
})

await run("SL-2 StructuredLogEntry type has required fields", () => {
  assert.ok(loggerSource.includes("export type StructuredLogEntry = {"))
  assert.ok(loggerSource.includes("ts: string"))
  assert.ok(loggerSource.includes("level: LogLevel"))
  assert.ok(loggerSource.includes("event: string"))
})

await run("SL-3 LogLevel covers all four levels", () => {
  assert.ok(loggerSource.includes('"info"'))
  assert.ok(loggerSource.includes('"warn"'))
  assert.ok(loggerSource.includes('"error"'))
  assert.ok(loggerSource.includes('"debug"'))
  assert.ok(loggerSource.includes("export type LogLevel ="))
})

await run("SL-4 reserved fields (ts/level/event) are set AFTER spread so they cannot be overwritten", () => {
  // The spread must come BEFORE the reserved fields in the object literal.
  // If spread comes after, user metadata with keys 'ts', 'level', or 'event' would
  // overwrite the authoritative values set by the logger.
  const entryStart = loggerSource.indexOf("const entry: StructuredLogEntry = {")
  assert.ok(entryStart !== -1, "entry object literal not found")
  const entryBody = loggerSource.slice(entryStart, entryStart + 300)
  const spreadIdx = entryBody.indexOf("...sanitizeMissionTelemetryMetadata(")
  const tsIdx = entryBody.indexOf("ts: new Date(")
  const levelIdx = entryBody.indexOf("level,")
  const eventIdx = entryBody.indexOf("event,")
  assert.ok(spreadIdx !== -1, "sanitizeMissionTelemetryMetadata spread not found")
  assert.ok(tsIdx !== -1, "ts field not found")
  assert.ok(levelIdx !== -1, "level field not found")
  assert.ok(eventIdx !== -1, "event field not found")
  // Spread must appear BEFORE ts, level, and event
  assert.ok(spreadIdx < tsIdx, "spread must precede ts field (reserved field overwrite protection)")
  assert.ok(spreadIdx < levelIdx, "spread must precede level field")
  assert.ok(spreadIdx < eventIdx, "spread must precede event field")
})

await run("SL-5 log uses sanitizeMissionTelemetryMetadata for PII redaction", () => {
  assert.ok(loggerSource.includes("sanitizeMissionTelemetryMetadata"))
  assert.ok(loggerSource.includes('from "@/lib/missions/telemetry/sanitizer"'))
})

await run("SL-6 log has serialize-failure fallback", () => {
  assert.ok(loggerSource.includes("JSON.stringify(entry)"))
  assert.ok(loggerSource.includes("} catch {") || loggerSource.includes("} catch ("))
  // Fallback must call console
  assert.ok(loggerSource.includes("console[level]") || loggerSource.includes("serialize failed"))
})

await run("SL-7 log routes to correct console method per level", () => {
  assert.ok(loggerSource.includes('level === "error"'))
  assert.ok(loggerSource.includes("console.error("))
  assert.ok(loggerSource.includes("console.warn("))
  assert.ok(loggerSource.includes("console.log("))
})

await run("SL-8 sanitizer redacts PII patterns", () => {
  // The sanitizer this logger depends on must cover credentials
  assert.ok(sanitizerSource.includes("BEARER_REGEX"))
  assert.ok(sanitizerSource.includes("JWT_REGEX"))
  assert.ok(sanitizerSource.includes("[redacted:"))
  assert.ok(sanitizerSource.includes("SENSITIVE_KEY_REGEX"))
})

await run("SL-9 structured-logger is server-only", () => {
  assert.ok(loggerSource.includes('import "server-only"'))
})

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : ""
  console.log(`[${result.status}] ${result.name}${detail}`)
}

const passCount = results.filter((r) => r.status === "PASS").length
const failCount = results.filter((r) => r.status === "FAIL").length

console.log(`\nTotal: ${results.length} | Pass: ${passCount} | Fail: ${failCount}`)

if (failCount > 0) {
  process.exit(1)
}
