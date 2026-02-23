import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = { days: 7, failOnBreach: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (token === "--days") {
      const next = Number.parseInt(String(argv[i + 1] || ""), 10);
      if (Number.isFinite(next)) out.days = Math.max(1, Math.min(30, next));
      i += 1;
      continue;
    }
    if (token === "--fail-on-breach") {
      out.failOnBreach = true;
    }
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

function computeP95(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
  return Number(sorted[idx] || 0);
}

function summarize(events) {
  const validations = events.filter((event) => event.eventType === "mission.validation.completed");
  const validationPasses = validations.filter((event) => event.status !== "error").length;
  const runs = events.filter((event) => event.eventType === "mission.run.completed" || event.eventType === "mission.run.failed");
  const runSuccesses = runs.filter((event) => event.eventType === "mission.run.completed" && event.status === "success").length;
  const retries = runs.filter((event) => Number(event?.metadata?.attempt || 1) > 1).length;
  const durations = runs
    .map((event) => Number(event.durationMs || 0))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return {
    totalEvents: events.length,
    validationPassRate: validations.length > 0 ? validationPasses / validations.length : 1,
    runSuccessRate: runs.length > 0 ? runSuccesses / runs.length : 1,
    retryRate: runs.length > 0 ? retries / runs.length : 0,
    runP95Ms: computeP95(durations),
    validationCount: validations.length,
    runCount: runs.length,
  };
}

function toPct(value) {
  return `${Math.round(Number(value || 0) * 10000) / 100}%`;
}

function nowIsoDate() {
  return new Date().toISOString().slice(0, 10);
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
  const logPath = path.join(
    workspaceRoot,
    ".agent",
    "user-context",
    userContextId,
    "logs",
    "mission-telemetry.jsonl",
  );
  const reportDir = path.join(
    workspaceRoot,
    ".agent",
    "user-context",
    userContextId,
    "reports",
  );
  fs.mkdirSync(reportDir, { recursive: true });

  const allEvents = readJsonl(logPath);
  const sinceMs = Date.now() - args.days * 24 * 60 * 60 * 1000;
  const events = allEvents.filter((event) => {
    const tsMs = Date.parse(String(event.ts || ""));
    return Number.isFinite(tsMs) && tsMs >= sinceMs;
  });

  const summary = summarize(events);
  const sloPolicy = {
    validationPassRateMin: Number.parseFloat(process.env.NOVA_MISSION_SLO_VALIDATION_PASS_RATE_MIN || "0.98"),
    runSuccessRateMin: Number.parseFloat(process.env.NOVA_MISSION_SLO_RUN_SUCCESS_RATE_MIN || "0.97"),
    retryRateMax: Number.parseFloat(process.env.NOVA_MISSION_SLO_RETRY_RATE_MAX || "0.10"),
    runP95MsMax: Number.parseInt(process.env.NOVA_MISSION_SLO_RUN_P95_MS_MAX || "30000", 10),
  };
  const slos = [
    {
      metric: "validationPassRate",
      ok: summary.validationPassRate >= sloPolicy.validationPassRateMin,
      value: summary.validationPassRate,
      target: sloPolicy.validationPassRateMin,
      unit: "ratio",
    },
    {
      metric: "runSuccessRate",
      ok: summary.runSuccessRate >= sloPolicy.runSuccessRateMin,
      value: summary.runSuccessRate,
      target: sloPolicy.runSuccessRateMin,
      unit: "ratio",
    },
    {
      metric: "retryRate",
      ok: summary.retryRate <= sloPolicy.retryRateMax,
      value: summary.retryRate,
      target: sloPolicy.retryRateMax,
      unit: "ratio",
    },
    {
      metric: "runP95Ms",
      ok: summary.runP95Ms <= sloPolicy.runP95MsMax,
      value: summary.runP95Ms,
      target: sloPolicy.runP95MsMax,
      unit: "ms",
    },
  ];

  const breached = slos.filter((row) => !row.ok);
  const reportDate = nowIsoDate();
  const reportPath = path.join(reportDir, `mission-reliability-review-${reportDate}.md`);
  const lines = [
    "# Mission Reliability Weekly Review",
    "",
    `- Date: ${new Date().toISOString()}`,
    `- User Context: ${userContextId}`,
    `- Lookback Days: ${args.days}`,
    `- Telemetry Source: ${logPath}`,
    "",
    "## Summary",
    `- Total events: ${summary.totalEvents}`,
    `- Validation events: ${summary.validationCount}`,
    `- Run events: ${summary.runCount}`,
    `- Validation pass rate: ${toPct(summary.validationPassRate)}`,
    `- Run success rate: ${toPct(summary.runSuccessRate)}`,
    `- Retry rate: ${toPct(summary.retryRate)}`,
    `- Run p95 latency: ${Math.round(summary.runP95Ms)} ms`,
    "",
    "## SLO Conformance",
    ...slos.map((row) =>
      row.unit === "ratio"
        ? `- ${row.metric}: ${toPct(row.value)} (target ${row.metric === "retryRate" ? "<=" : ">="} ${toPct(row.target)}) -> ${row.ok ? "OK" : "BREACH"}`
        : `- ${row.metric}: ${Math.round(row.value)} ms (target <= ${Math.round(row.target)} ms) -> ${row.ok ? "OK" : "BREACH"}`,
    ),
    "",
    "## Actions",
    breached.length === 0
      ? "- No immediate mitigation required."
      : "- Follow tasks/runbooks/mission-reliability-runbook.md for breached metrics.",
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");

  const indexPath = path.join(reportDir, "mission-reliability-review-index.jsonl");
  const record = {
    ts: new Date().toISOString(),
    userContextId,
    reportPath: path.relative(workspaceRoot, reportPath).replace(/\\/g, "/"),
    lookbackDays: args.days,
    summary,
    slos,
    breachCount: breached.length,
  };
  fs.appendFileSync(indexPath, `${JSON.stringify(record)}\n`, "utf8");

  console.log(`[phase6] Reliability review written: ${path.relative(workspaceRoot, reportPath)}`);
  console.log(`[phase6] SLO breach count: ${breached.length}`);

  if (args.failOnBreach && breached.length > 0) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
