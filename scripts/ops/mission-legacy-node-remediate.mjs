import fs from "node:fs";
import path from "node:path";

const LEGACY_TO_MODERN_NODE_TYPE = {
  "sub-workflow": "agent-subworkflow",
};

function parseArgs(argv) {
  const out = {
    userContextId: "",
    apply: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (token === "--user-context-id") {
      out.userContextId = String(argv[i + 1] || "").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (token === "--apply") {
      out.apply = true;
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

function listUserContextIds(userContextRoot, scopedUserContextId) {
  if (scopedUserContextId) return [scopedUserContextId];
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

function readStore(filePath) {
  if (!fs.existsSync(filePath)) {
    return { ok: true, payload: { version: 1, missions: [] }, error: "" };
  }
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const missions = Array.isArray(payload?.missions) ? payload.missions : [];
    return {
      ok: true,
      payload: { ...payload, missions },
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      payload: { version: 1, missions: [] },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeSubWorkflowNode(node) {
  return {
    ...node,
    type: "agent-subworkflow",
    missionId: String(node?.missionId || "").trim(),
    waitForCompletion: node?.waitForCompletion !== false,
    inputMapping:
      node?.inputMapping && typeof node.inputMapping === "object" && !Array.isArray(node.inputMapping)
        ? node.inputMapping
        : {},
  };
}

function remediateMissions(payload, userContextId) {
  const remediations = [];
  const missions = Array.isArray(payload?.missions) ? payload.missions : [];
  let changed = false;

  const updatedMissions = missions.map((mission) => {
    const nodes = Array.isArray(mission?.nodes) ? mission.nodes : [];
    let missionChanged = false;
    const updatedNodes = nodes.map((node, nodeIndex) => {
      const nodeType = String(node?.type || "").trim();
      const nextType = LEGACY_TO_MODERN_NODE_TYPE[nodeType];
      if (!nextType) return node;
      missionChanged = true;
      changed = true;
      remediations.push({
        userContextId,
        missionId: String(mission?.id || "").trim(),
        missionLabel: String(mission?.label || "").trim(),
        nodeId: String(node?.id || "").trim(),
        nodeLabel: String(node?.label || "").trim(),
        fromType: nodeType,
        toType: nextType,
        nodePath: `missions.${String(mission?.id || "unknown")}.nodes[${nodeIndex}]`,
      });
      if (nodeType === "sub-workflow" && nextType === "agent-subworkflow") {
        return normalizeSubWorkflowNode(node);
      }
      return { ...node, type: nextType };
    });
    if (!missionChanged) return mission;
    return {
      ...mission,
      nodes: updatedNodes,
      updatedAt: new Date().toISOString(),
    };
  });

  return {
    changed,
    payload: {
      ...payload,
      missions: updatedMissions,
      updatedAt: new Date().toISOString(),
    },
    remediations,
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function nowIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot();
  const userContextRoot = resolveUserContextRoot(workspaceRoot);
  const envScopedUser = String(process.env.NOVA_LEGACY_REMEDIATE_USER_CONTEXT_ID || "").trim().toLowerCase();
  const scopedUserContextId = args.userContextId || envScopedUser;
  const userContextIds = listUserContextIds(userContextRoot, scopedUserContextId);

  if (userContextIds.length === 0) {
    console.log("[legacy-remediate] No user contexts found to process.");
    process.exit(0);
  }

  const allRemediations = [];
  const parseErrors = [];
  let scannedMissions = 0;
  let changedStores = 0;

  for (const userContextId of userContextIds) {
    const storePath = path.join(userContextRoot, userContextId, "state", "missions.json");
    const loaded = readStore(storePath);
    if (!loaded.ok) {
      parseErrors.push({
        userContextId,
        storePath: path.relative(workspaceRoot, storePath).replace(/\\/g, "/"),
        error: loaded.error,
      });
      continue;
    }
    scannedMissions += Array.isArray(loaded.payload?.missions) ? loaded.payload.missions.length : 0;
    const result = remediateMissions(loaded.payload, userContextId);
    allRemediations.push(...result.remediations);
    if (args.apply && result.changed) {
      writeJson(storePath, result.payload);
      changedStores += 1;
    }
  }

  const summary = {
    ts: new Date().toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    userContextCount: userContextIds.length,
    missionCount: scannedMissions,
    remediationCount: allRemediations.length,
    changedStoreCount: changedStores,
    remediations: allRemediations,
    parseErrors,
  };

  const reportDir = path.join(workspaceRoot, "scripts", "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `mission-legacy-node-remediation-${nowIsoDate()}.json`);
  writeJson(reportPath, summary);

  console.log(`[legacy-remediate] mode=${summary.mode}`);
  console.log(`[legacy-remediate] scanned userContexts=${summary.userContextCount} missions=${summary.missionCount}`);
  console.log(`[legacy-remediate] remediations=${summary.remediationCount} changedStores=${summary.changedStoreCount}`);
  console.log(`[legacy-remediate] report: ${path.relative(workspaceRoot, reportPath).replace(/\\/g, "/")}`);
  if (summary.parseErrors.length > 0) {
    console.log(`[legacy-remediate] parseErrors=${summary.parseErrors.length}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
