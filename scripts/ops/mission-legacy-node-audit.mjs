/**
 * Mission legacy-node audit (ops tool): lists missions that still use a legacy node type.
 *
 * Reads the `missions` table of `<dataDir>/nova.db`, with the data dir resolved exactly like the app does
 * (src/db/paths.js: NOVA_DATA_DIR, packaged %APPDATA%\Nova, else <repo>/.user). `--data-dir <dir>` audits another
 * data dir. The database is opened READ-ONLY (no migrations, no writes).
 *
 *   node scripts/ops/mission-legacy-node-audit.mjs [--data-dir <dir>] [--user-context-id <id>] [--strict] [--no-report]
 *
 * Exit codes: 0 clean (or no database yet), 2 with --strict when findings or unreadable missions exist, 1 on error.
 * Smokes never audit the real data dir: smoke:src-missions runs scripts/smoke/quality/src-mission-legacy-audit-smoke.mjs,
 * which seeds a temp data dir and runs this script against it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const LEGACY_NODE_REMEDIATIONS = {
  "sub-workflow": 'Replace with "agent-subworkflow" and route through command-spine handoff + audit.',
};

function parseArgs(argv) {
  const out = {
    userContextId: "",
    dataDir: "",
    strict: false,
    writeReport: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (token === "--user-context-id") {
      out.userContextId = String(argv[i + 1] || "").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (token === "--data-dir") {
      out.dataDir = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token === "--strict") {
      out.strict = true;
      continue;
    }
    if (token === "--no-report") {
      out.writeReport = false;
      continue;
    }
  }
  return out;
}

/** Read-only view of the missions table; `null` when the database does not exist yet. */
async function readMissionRows(dbFile, onlyUserContextId) {
  if (!fs.existsSync(dbFile)) return null;
  const { openDbAt } = await import("../../src/db/index.js");
  const db = openDbAt(dbFile, { readonly: true });
  try {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'missions'").get();
    if (!hasTable) return [];
    if (onlyUserContextId) {
      return db.prepare("SELECT user_id, id, data_json FROM missions WHERE user_id = ? ORDER BY user_id, id").all(onlyUserContextId);
    }
    return db.prepare("SELECT user_id, id, data_json FROM missions ORDER BY user_id, id").all();
  } finally {
    db.close();
  }
}

function collectFindings(userContextId, mission) {
  const findings = [];
  const nodes = Array.isArray(mission?.nodes) ? mission.nodes : [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const nodeType = String(node?.type || "").trim();
    if (!(nodeType in LEGACY_NODE_REMEDIATIONS)) continue;
    findings.push({
      userContextId,
      missionId: String(mission?.id || "").trim(),
      missionLabel: String(mission?.label || "").trim(),
      nodeId: String(node?.id || "").trim(),
      nodeLabel: String(node?.label || "").trim(),
      nodeType,
      nodePath: `missions.${String(mission?.id || "unknown")}.nodes[${i}]`,
      remediation: LEGACY_NODE_REMEDIATIONS[nodeType],
    });
  }
  return findings;
}

function nowIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function writeReports(payload) {
  const reportDir = path.join(REPO_ROOT, "scripts", "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = nowIsoDate();
  const mdPath = path.join(reportDir, `mission-legacy-node-audit-${stamp}.md`);
  const jsonPath = path.join(reportDir, `mission-legacy-node-audit-${stamp}.json`);

  const lines = [
    "# Mission Legacy Node Audit",
    "",
    `- Date: ${new Date().toISOString()}`,
    `- Database: ${payload.dbFile}`,
    `- User contexts scanned: ${payload.userContextCount}`,
    `- Missions scanned: ${payload.missionCount}`,
    `- Findings: ${payload.findingCount}`,
    `- Legacy node types: ${Object.keys(LEGACY_NODE_REMEDIATIONS).join(", ")}`,
    "",
  ];

  if (payload.parseErrors.length > 0) {
    lines.push("## Mission Read Errors");
    for (const row of payload.parseErrors) {
      lines.push(`- ${row.userContextId}/${row.missionId}: ${row.error}`);
    }
    lines.push("");
  }

  if (payload.findings.length === 0) {
    lines.push("## Result");
    lines.push("- PASS: no legacy mission node usage detected.");
  } else {
    lines.push("## Findings");
    lines.push("| userContextId | missionId | missionLabel | nodeId | nodeLabel | nodeType | remediation |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const row of payload.findings) {
      lines.push(
        `| ${row.userContextId} | ${row.missionId || "-"} | ${row.missionLabel || "-"} | ${row.nodeId || "-"} | ${row.nodeLabel || "-"} | ${row.nodeType} | ${row.remediation} |`,
      );
    }
  }

  fs.writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    mdPath: path.relative(REPO_ROOT, mdPath).replace(/\\/g, "/"),
    jsonPath: path.relative(REPO_ROOT, jsonPath).replace(/\\/g, "/"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.dataDir) process.env.NOVA_DATA_DIR = path.resolve(args.dataDir);
  const { DB_FILENAME, resolveDataDir } = await import("../../src/db/paths.js");
  const dbFile = path.join(resolveDataDir(), DB_FILENAME);
  const envScopedUser = String(process.env.NOVA_LEGACY_AUDIT_USER_CONTEXT_ID || "").trim().toLowerCase();
  const scopedUserContextId = args.userContextId || envScopedUser;

  console.log(`[legacy-audit] database: ${dbFile}`);
  const rows = await readMissionRows(dbFile, scopedUserContextId);
  if (rows === null) {
    console.log("[legacy-audit] No database found to scan.");
    process.exit(0);
  }

  const findings = [];
  const parseErrors = [];
  const userContextIds = new Set();
  let missionCount = 0;

  for (const row of rows) {
    const userContextId = String(row.user_id || "");
    userContextIds.add(userContextId);
    let mission;
    try {
      mission = JSON.parse(row.data_json);
    } catch (error) {
      parseErrors.push({
        userContextId,
        missionId: String(row.id || ""),
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    missionCount += 1;
    findings.push(...collectFindings(userContextId, mission));
  }

  const payload = {
    ts: new Date().toISOString(),
    dbFile,
    userContextCount: userContextIds.size,
    missionCount,
    findingCount: findings.length,
    legacyNodeTypes: Object.keys(LEGACY_NODE_REMEDIATIONS),
    findings,
    parseErrors,
  };

  if (args.writeReport) {
    const paths = writeReports(payload);
    console.log(`[legacy-audit] report markdown: ${paths.mdPath}`);
    console.log(`[legacy-audit] report json: ${paths.jsonPath}`);
  }

  console.log(
    `[legacy-audit] scanned userContexts=${payload.userContextCount} missions=${payload.missionCount} findings=${payload.findingCount} readErrors=${payload.parseErrors.length}`,
  );
  if (payload.findings.length > 0) {
    for (const row of payload.findings.slice(0, 20)) {
      console.log(
        `[legacy-audit] finding user=${row.userContextId} mission=${row.missionId || "unknown"} node=${row.nodeId || "unknown"} type=${row.nodeType}`,
      );
    }
    if (payload.findings.length > 20) {
      console.log(`[legacy-audit] ... ${payload.findings.length - 20} additional finding(s) omitted from console output.`);
    }
  }

  if (args.strict && (payload.findingCount > 0 || payload.parseErrors.length > 0)) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
