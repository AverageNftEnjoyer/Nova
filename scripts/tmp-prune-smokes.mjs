import fs from "node:fs"
import path from "node:path"

const drop = `scripts/smoke/audit/p1-it-word-regression/smoke.mjs
scripts/smoke/audit/p2-rule-newline/smoke.mjs
scripts/smoke/audit/p5-workspace-write/smoke.mjs
scripts/smoke/audit/p6-skills-depth/smoke.mjs
scripts/smoke/audit/skills-apostrophe/smoke.mjs
scripts/smoke/audit/starter-seeding/smoke.mjs
scripts/smoke/calendar/hud-calendar-reschedule-smoke.mjs
scripts/smoke/conversation/live-latency-check.mjs
scripts/smoke/conversation/src-chatkit-serve-routing-smoke.mjs
scripts/smoke/conversation/src-chatkit-shadow-routing-smoke.mjs
scripts/smoke/conversation/src-chatkit-structured-workflow-smoke.mjs
scripts/smoke/conversation/src-conversation-quality-30turn-smoke.mjs
scripts/smoke/conversation/src-identity-intelligence-runtime-smoke.mjs
scripts/smoke/conversation/src-identity-intelligence-unit-smoke.mjs
scripts/smoke/conversation/src-output-constraints-smoke.mjs
scripts/smoke/conversation/src-persona-context-smoke.mjs
scripts/smoke/conversation/src-user-preferences-smoke.mjs
scripts/smoke/core/src-chatkit-runtime-config-smoke.mjs
scripts/smoke/core/src-provider-smoke.mjs
scripts/smoke/core/src-runtime-relocation-smoke.mjs
scripts/smoke/core/src-session-parity.mjs
scripts/smoke/core/src-shell-parity-smoke.mjs
scripts/smoke/core/src-user-root-smoke.mjs
scripts/smoke/hud/hud-spotify-boot-spam-throttle-smoke.mjs
scripts/smoke/hud/hud-spotify-integration-smoke.mjs
scripts/smoke/hud/hud-spotify-playlist-favorites-live-smoke.mjs
scripts/smoke/hud/hud-spotify-search-precision-smoke.mjs
scripts/smoke/hud/hud-thread-delete-canary-smoke.mjs
scripts/smoke/hud/hud-thread-delete-transcript-smoke.mjs
scripts/smoke/logging/structured-logger-smoke.mjs
scripts/smoke/media/background-assets-smoke.mjs
scripts/smoke/missions/src-mission-build-execution-smoke.mjs
scripts/smoke/missions/src-mission-build-from-prompt-smoke.mjs
scripts/smoke/missions/src-mission-build-service-smoke.mjs
scripts/smoke/missions/src-mission-calendar-mirror-smoke.mjs
scripts/smoke/missions/src-mission-generation-helpers-smoke.mjs
scripts/smoke/missions/src-mission-graph-validation-smoke.mjs
scripts/smoke/missions/src-mission-llm-graph-parser-smoke.mjs
scripts/smoke/missions/src-mission-persistence-smoke.mjs
scripts/smoke/missions/src-mission-scheduler-service-smoke.mjs
scripts/smoke/missions/src-mission-telemetry-reliability-smoke.mjs
scripts/smoke/perf/idle-measure.mjs
scripts/smoke/perf/perf-client-polling-source-guard-smoke.mjs
scripts/smoke/perf/perf-ui-source-guard-smoke.mjs
scripts/smoke/perf/server-idle-cost-smoke.mjs
scripts/smoke/quality/src-chatkit-release-readiness-smoke.mjs
scripts/smoke/quality/src-response-quality-guard-smoke.mjs
scripts/smoke/quality/chatkit-release-baseline.json
scripts/smoke/routing/run-multilayer-checkpoint.ps1
scripts/smoke/routing/src-calendar-domain-service-smoke.mjs
scripts/smoke/routing/src-calendar-live-smoke.mjs
scripts/smoke/routing/src-delegated-chat-worker-contract-smoke.mjs
scripts/smoke/routing/src-delegated-domain-service-smoke.mjs
scripts/smoke/routing/src-diagnostics-domain-service-smoke.mjs
scripts/smoke/routing/src-discord-domain-worker-smoke.mjs
scripts/smoke/routing/src-files-domain-service-smoke.mjs
scripts/smoke/routing/src-gmail-domain-service-smoke.mjs
scripts/smoke/routing/src-handle-input-special-workers-smoke.mjs
scripts/smoke/routing/src-market-closure-smoke.mjs
scripts/smoke/routing/src-market-domain-service-smoke.mjs
scripts/smoke/routing/src-market-nonweather-live-smoke.mjs
scripts/smoke/routing/src-missions-domain-service-smoke.mjs
scripts/smoke/routing/src-multilayer-agentic-completeness-smoke.mjs
scripts/smoke/routing/src-notes-domain-smoke.mjs
scripts/smoke/routing/src-operator-intent-signals-smoke.mjs
scripts/smoke/routing/src-operator-lane-registry-consistency-smoke.mjs
scripts/smoke/routing/src-operator-lane-wiring-smoke.mjs
scripts/smoke/routing/src-operator-route-decisions-smoke.mjs
scripts/smoke/routing/src-org-chart-delegation-smoke.mjs
scripts/smoke/routing/src-org-chart-routing-registry-smoke.mjs
scripts/smoke/routing/src-platform-contract-live-smoke.mjs
scripts/smoke/routing/src-polymarket-domain-service-smoke.mjs
scripts/smoke/routing/src-polymarket-live-smoke.mjs
scripts/smoke/routing/src-reminders-domain-service-smoke.mjs
scripts/smoke/routing/src-short-term-context-policies-smoke.mjs
scripts/smoke/routing/src-shutdown-domain-service-smoke.mjs
scripts/smoke/routing/src-telegram-domain-service-smoke.mjs
scripts/smoke/routing/src-tool-loop-concurrency-smoke.mjs
scripts/smoke/routing/src-tool-loop-guardrails-smoke.mjs
scripts/smoke/routing/src-tool-runtime-bootstrap-smoke.mjs
scripts/smoke/routing/src-voice-tts-domain-service-smoke.mjs
scripts/smoke/routing/src-voice-tts-live-smoke.mjs
scripts/smoke/routing/src-voice-tts-runtime-isolation-smoke.mjs
scripts/smoke/routing/src-voice-tts-transport-smoke.mjs
scripts/smoke/routing/src-web-research-domain-service-smoke.mjs
scripts/smoke/runtime/dev-conversation-log-retention-smoke.mjs
scripts/smoke/runtime/hud-thinking-orb-invariant-smoke.mjs
scripts/smoke/runtime/integration-api-bridge-smoke.mjs
scripts/smoke/runtime/openai-request-tuning-smoke.mjs
scripts/smoke/runtime/spotify-intent-routing-smoke.mjs
scripts/smoke/runtime/spotify-user-context-isolation-smoke.mjs
scripts/smoke/scheduler/src-coinbase-workflow-step-artifact-smoke.mjs
scripts/smoke/scheduler/src-coinbase-workflow-step-isolation-smoke.mjs
scripts/smoke/scheduler/src-scheduler-coinbase-pnl-comment-delivery-smoke.mjs
scripts/smoke/scheduler/src-scheduler-delivery-smoke.mjs
scripts/smoke/scheduler/src-scheduler-skills-snapshot-smoke.mjs
scripts/smoke/scheduler/src-scheduler-store-smoke.mjs
scripts/smoke/security/src-identity-profile-divergence-smoke.mjs
scripts/smoke/token-efficiency/live-token-check.mjs
scripts/smoke/token-efficiency/model-routing-cost.mjs
scripts/smoke/workstreams/src-workstream-b-live-smoke.mjs
scripts/smoke/workstreams/src-workstream-d-latency-smoke.mjs
scripts/smoke/workstreams/src-workstream-d-live-latency-smoke.mjs
scripts/smoke/workstreams/src-workstream-e-session-key-smoke.mjs
scripts/smoke/worktree/worktree-smoke.mjs
scripts/smoke/fixtures/chatkit-release-events.jsonl
scripts/coinbase/smoke/src-coinbase-pnl-personality-comment-smoke.mjs`.trim().split(/\r?\n/)

let removed = 0
for (const relative of drop) {
  if (!fs.existsSync(relative)) {
    console.log("missing", relative)
    continue
  }
  fs.rmSync(relative)
  removed += 1
}

function removeEmpty(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmpty(path.join(dir, entry.name))
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}
removeEmpty("scripts/smoke/audit")
removeEmpty("scripts/smoke/workstreams")
removeEmpty("scripts/smoke/worktree")
removeEmpty("scripts/smoke/logging")
removeEmpty("scripts/smoke/media")
removeEmpty("scripts/smoke/missions")
removeEmpty("scripts/smoke/perf")
removeEmpty("scripts/smoke/fixtures")

const pkgPath = "package.json"
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
const deletedPaths = drop.filter((file) => file.endsWith(".mjs") || file.endsWith(".ps1"))
const removedScripts = []
for (const [name, command] of Object.entries(pkg.scripts)) {
  if (deletedPaths.some((file) => command.includes(file))) {
    delete pkg.scripts[name]
    removedScripts.push(name)
  }
}
let changed = true
while (changed) {
  changed = false
  for (const [name, command] of Object.entries(pkg.scripts)) {
    const missing = [...command.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1]).filter((script) => !(script in pkg.scripts))
    if (missing.length === 0) continue
    const parts = command.split(" && ").map((part) => part.trim()).filter((part) => {
      const match = /^npm run ([\w:-]+)$/.exec(part)
      return !(match && !(match[1] in pkg.scripts))
    })
    if (parts.length === 0) {
      delete pkg.scripts[name]
      removedScripts.push(name)
    } else if (parts.join(" && ") !== command) {
      pkg.scripts[name] = parts.join(" && ")
    } else {
      delete pkg.scripts[name]
      removedScripts.push(name)
    }
    changed = true
  }
}
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`removed files ${removed}`)
console.log(`removed scripts ${removedScripts.length}`)
console.log(removedScripts.sort().join("\n"))
