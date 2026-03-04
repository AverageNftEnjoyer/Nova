import fs from "node:fs";
import path from "node:path";

const LEGACY_NODE_REMEDIATIONS = {
  "sub-workflow": 'Replace with "agent-subworkflow" and route through command-spine handoff + audit.',
};

function parseArgs(argv) {
  const out = {
    userContextId: "",
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

function resolveWorkspaceRoot() {
  const cwd = process.cwd();
  return path.basename(cwd).toLowerCase() === "hud" ? path.resolve(cwd, "..") : cwd;
}

function resolveUserContextRoot(workspaceRoot) {
  return path.join(workspaceRoot, ".user", "user-context");
}

function listUserContextIds(userContextRoot, onlyUserContextId) {
  if (onlyUserContextId) return [onlyUserContextId];
  try {
    return fs
      .readdirSync(userContextRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => String(entry.name || "").trim().toLowerCase())
      .filter((name) => /^[a-z0-9_-]+$/.test(name));
  } catch {
    return [];
  }
}

function readMissionsStore(filePath) {
  if (!fs.existsSync(filePath)) {
    return { ok: true, missions: [], error: "" };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const missions = Array.isArray(parsed?.missions) ? parsed.missions : [];
    return { ok: true, missions, error: "" };
  } catch (error) {
    return {
      ok: false,
      missions: [],
      error: error instanceof Error ? error.message : String(error),
    };
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

function writeReports(workspaceRoot, payload) {
  const reportDir = path.join(workspaceRoot, "scripts", "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = nowIsoDate();
  const mdPath = path.join(reportDir, `mission-legacy-node-audit-${stamp}.md`);
  const jsonPath = path.join(reportDir, `mission-legacy-node-audit-${stamp}.json`);

  const lines = [
    "# Mission Legacy Node Audit",
    "",
    `- Date: ${new Date().toISOString()}`,
    `- User contexts scanned: ${payload.userContextCount}`,
    `- Missions scanned: ${payload.missionCount}`,
    `- Findings: ${payload.findingCount}`,
    `- Legacy node types: ${Object.keys(LEGACY_NODE_REMEDIATIONS).join(", ")}`,
    "",
  ];

  if (payload.parseErrors.length > 0) {
    lines.push("## Store Read Errors");
    for (const row of payload.parseErrors) {
      lines.push(`- ${row.userContextId}: ${row.error}`);
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
    mdPath: path.relative(workspaceRoot, mdPath).replace(/\\/g, "/"),
    jsonPath: path.relative(workspaceRoot, jsonPath).replace(/\\/g, "/"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot();
  const userContextRoot = resolveUserContextRoot(workspaceRoot);
  const envScopedUser = String(process.env.NOVA_LEGACY_AUDIT_USER_CONTEXT_ID || "").trim().toLowerCase();
  const scopedUserContextId = args.userContextId || envScopedUser;

  const userContextIds = listUserContextIds(userContextRoot, scopedUserContextId);
  if (userContextIds.length === 0) {
    console.log("[legacy-audit] No user contexts found to scan.");
    process.exit(0);
  }

  const findings = [];
  const parseErrors = [];
  let missionCount = 0;

  for (const userContextId of userContextIds) {
    const missionsPath = path.join(userContextRoot, userContextId, "state", "missions.json");
    const loaded = readMissionsStore(missionsPath);
    if (!loaded.ok) {
      parseErrors.push({
        userContextId,
        missionsPath: path.relative(workspaceRoot, missionsPath).replace(/\\/g, "/"),
        error: loaded.error,
      });
      continue;
    }
    missionCount += loaded.missions.length;
    for (const mission of loaded.missions) {
      findings.push(...collectFindings(userContextId, mission));
    }
  }

  const payload = {
    ts: new Date().toISOString(),
    userContextCount: userContextIds.length,
    missionCount,
    findingCount: findings.length,
    legacyNodeTypes: Object.keys(LEGACY_NODE_REMEDIATIONS),
    findings,
    parseErrors,
  };

  if (args.writeReport) {
    const paths = writeReports(workspaceRoot, payload);
    console.log(`[legacy-audit] report markdown: ${paths.mdPath}`);
    console.log(`[legacy-audit] report json: ${paths.jsonPath}`);
  }

  console.log(
    `[legacy-audit] scanned userContexts=${payload.userContextCount} missions=${payload.missionCount} findings=${payload.findingCount}`,
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

  if (args.strict && payload.findingCount > 0) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
