import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = { days: 7, staleRunMinutes: 20, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (token === "--days") {
      const next = Number.parseInt(String(argv[i + 1] || ""), 10);
      if (Number.isFinite(next)) out.days = Math.max(1, Math.min(30, next));
      i += 1;
      continue;
    }
    if (token === "--stale-run-minutes") {
      const next = Number.parseInt(String(argv[i + 1] || ""), 10);
      if (Number.isFinite(next)) out.staleRunMinutes = Math.max(5, Math.min(240, next));
      i += 1;
      continue;
    }
    if (token === "--strict") out.strict = true;
  }
  return out;
}

function resolveWorkspaceRoot() {
  const cwd = process.cwd();
  return path.basename(cwd).toLowerCase() === "hud" ? path.resolve(cwd, "..") : cwd;
}

function readJsonl(filePath) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function nowIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildStuckRunCount(events, staleMs) {
  const starts = new Map();
  const completed = new Set();
  const failed = new Set();
  for (const event of events) {
    const runId = String(event.missionRunId || "").trim();
    if (!runId) continue;
    if (event.eventType === "mission.run.started") {
      const tsMs = Date.parse(String(event.ts || ""));
      if (Number.isFinite(tsMs)) starts.set(runId, tsMs);
    } else if (event.eventType === "mission.run.completed") {
      completed.add(runId);
    } else if (event.eventType === "mission.run.failed") {
      failed.add(runId);
    }
  }
  const nowMs = Date.now();
  let stuck = 0;
  for (const [runId, tsMs] of starts.entries()) {
    if (completed.has(runId) || failed.has(runId)) continue;
    if (nowMs - tsMs >= staleMs) stuck += 1;
  }
  return stuck;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userContextId = String(
    process.env.NOVA_REVIEW_USER_CONTEXT_ID ||
      process.env.NOVA_SMOKE_USER_CONTEXT_ID ||
      process.env.NOVA_MISSION_REVIEW_USER_CONTEXT_ID ||
      "",
  )
    .trim()
    .toLowerCase();
  if (!userContextId) {
    console.error("Missing user context. Set NOVA_REVIEW_USER_CONTEXT_ID or NOVA_SMOKE_USER_CONTEXT_ID.");
    process.exit(1);
  }

  const workspaceRoot = resolveWorkspaceRoot();
  const telemetryPath = path.join(
    workspaceRoot,
    ".agent",
    "user-context",
    userContextId,
    "logs",
    "mission-telemetry.jsonl",
  );
  const logDir = path.join(workspaceRoot, ".agent", "user-context", userContextId, "logs");
  const reportDir = path.join(workspaceRoot, ".agent", "user-context", userContextId, "reports");
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });

  const allEvents = readJsonl(telemetryPath);
  const sinceMs = Date.now() - args.days * 24 * 60 * 60 * 1000;
  const events = allEvents.filter((event) => {
    const tsMs = Date.parse(String(event.ts || ""));
    return Number.isFinite(tsMs) && tsMs >= sinceMs;
  });

  const failedRunCount = events.filter((event) => event.eventType === "mission.run.failed").length;
  const rollbackFailureCount = events.filter((event) => event.eventType === "mission.rollback.failed").length;
  const stuckRunCount = buildStuckRunCount(events, args.staleRunMinutes * 60 * 1000);

  const drills = [
    {
      name: "failed-run drill",
      status: failedRunCount > 0 ? "pass" : "not_observed",
      evidence: `mission.run.failed count=${failedRunCount}`,
      action: "Run failed mission triage from tasks/runbooks/mission-reliability-runbook.md (Run success regression).",
    },
    {
      name: "stuck-queue drill",
      status: stuckRunCount === 0 ? "pass" : "fail",
      evidence: `stale mission.run.started without terminal event count=${stuckRunCount}`,
      action: "Run stuck queue triage from tasks/runbooks/mission-reliability-runbook.md (Run p95 breach / queue pressure).",
    },
    {
      name: "restore-failure drill",
      status: rollbackFailureCount > 0 ? "pass" : "not_observed",
      evidence: `mission.rollback.failed count=${rollbackFailureCount}`,
      action: "Run rollback failure triage from tasks/runbooks/mission-reliability-runbook.md (restore path).",
    },
  ];

  const hardFailing = drills.filter((row) => row.status === "fail");
  const notObserved = drills.filter((row) => row.status === "not_observed");
  const drillLogPath = path.join(logDir, "mission-runbook-drills.jsonl");
  const drillRecord = {
    ts: new Date().toISOString(),
    userContextId,
    lookbackDays: args.days,
    staleRunMinutes: args.staleRunMinutes,
    drillCount: drills.length,
    failCount: hardFailing.length,
    notObservedCount: notObserved.length,
    drills,
  };
  fs.appendFileSync(drillLogPath, `${JSON.stringify(drillRecord)}\n`, "utf8");

  const reportPath = path.join(reportDir, `mission-runbook-drills-${nowIsoDate()}.md`);
  const lines = [
    "# Mission Runbook Drill Evidence",
    "",
    `- Date: ${new Date().toISOString()}`,
    `- User Context: ${userContextId}`,
    `- Lookback Days: ${args.days}`,
    `- Stale Run Threshold (minutes): ${args.staleRunMinutes}`,
    `- Telemetry Source: ${telemetryPath}`,
    "",
    "## Drill Results",
    ...drills.map((row) => `- ${row.name}: ${String(row.status).toUpperCase()} (${row.evidence})`),
    "",
    "## Required Actions",
    ...drills.map((row) => `- ${row.name}: ${row.action}`),
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");

  console.log(`[phase6] Drill evidence written: ${path.relative(workspaceRoot, reportPath)}`);
  console.log(`[phase6] Drill log appended: ${path.relative(workspaceRoot, drillLogPath)}`);
  console.log(`[phase6] Drill hard failures: ${hardFailing.length}`);
  console.log(`[phase6] Drill not observed: ${notObserved.length}`);

  if (args.strict && (hardFailing.length > 0 || notObserved.length > 0)) {
    process.exit(3);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
