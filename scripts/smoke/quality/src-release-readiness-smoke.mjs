import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const results = [];

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

async function run(name, fn) {
  try {
    await fn();
    record("PASS", name);
  } catch (error) {
    record("FAIL", name, error instanceof Error ? error.message : String(error));
  }
}

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(process.cwd(), relativePath));
}

const packageJson = JSON.parse(read("package.json"));
const versionSourceCandidates = [
  "hud/lib/meta/version.ts",
  "hud/lib/version.ts",
];
const versionSourcePath = versionSourceCandidates.find((candidate) => fileExists(candidate)) || "";
const versionSource = versionSourcePath ? read(versionSourcePath) : "";
const envExample = read(".env.example");
const launcherBat = read("Nova.bat");
const launcherVbs = read("Nova.vbs");
const releaseNotesCandidates = [
  "scripts/reports/release-readiness-report.md",
  "scripts/reports/current-release-notes.md",
];
const releaseNotesPath = releaseNotesCandidates.find((candidate) => fileExists(candidate)) || "";
const releaseNotes = releaseNotesPath ? read(releaseNotesPath) : "";

await run("P20-C1 release gate scripts are present", async () => {
  const requiredScripts = [
    "smoke:src-eval",
    "smoke:src-prompt",
    "smoke:src-missions",
    "smoke:src-scheduler",
    "smoke:src-discord-delivery",
    "smoke:src-telegram-delivery",
    "smoke:src-transport",
    "smoke:src-tools",
    "smoke:src-security",
    "smoke:src-memory",
    "smoke:src-routing",
    "smoke:src-plugin-isolation",
    "smoke:src-security-regression",
    "smoke:src-coinbase-ci",
    "smoke:src-coinbase-readiness",
    "smoke:src-latency-gate",
    "smoke:src-release-readiness",
    "smoke:src-release",
    "verify:phase15",
  ];
  for (const scriptName of requiredScripts) {
    assert.equal(typeof packageJson?.scripts?.[scriptName], "string", `missing script: ${scriptName}`);
  }
});

await run("P20-C1b release gate includes Coinbase CI + readiness hard gates", async () => {
  const releaseScript = String(packageJson?.scripts?.["smoke:src-release"] || "");
  assert.equal(releaseScript.includes("smoke:src-coinbase-ci"), true, "missing coinbase CI gate in smoke:src-release");
  assert.equal(
    releaseScript.includes("smoke:src-coinbase-readiness"),
    true,
    "missing coinbase readiness gate in smoke:src-release",
  );
});

await run("P20-C1c release gate includes Telegram delivery hard gate", async () => {
  const releaseScript = String(packageJson?.scripts?.["smoke:src-release"] || "");
  assert.equal(
    releaseScript.includes("smoke:src-telegram-delivery"),
    true,
    "missing telegram delivery gate in smoke:src-release",
  );
});

await run("P20-C1d release gate includes Discord delivery hard gate", async () => {
  const releaseScript = String(packageJson?.scripts?.["smoke:src-release"] || "");
  assert.equal(
    releaseScript.includes("smoke:src-discord-delivery"),
    true,
    "missing discord delivery gate in smoke:src-release",
  );
});

await run("P20-C2 verify script points to a real file", async () => {
  const verifyScript = String(packageJson?.scripts?.["verify:phase15"] || "").trim();
  const match = /^node\s+(.+)$/.exec(verifyScript);
  assert.ok(match?.[1], "verify:phase15 must be a node script path");
  const target = match[1].trim().replace(/^\.\/+/, "");
  assert.equal(fileExists(target), true, `missing verify target: ${target}`);
});

await run("P20-C3 version and release docs are updated for final rollout", async () => {
  assert.equal(Boolean(versionSourcePath), true, "missing HUD version source file");
  assert.equal(versionSource.includes("export const NOVA_VERSION = "), true);
  assert.equal(versionSource.includes("Version History:"), true);
  assert.equal(Boolean(releaseNotesPath), true, "missing release notes artifact under scripts/reports/");
  assert.equal(/#\s+NovaOS/i.test(releaseNotes), true, "release notes must include a NovaOS title");
  assert.equal(releaseNotes.includes("## Rollout Checklist"), true);
  assert.equal(releaseNotes.includes("## Rollback Plan"), true);
});

await run("P20-C4 env docs include operational hardening knobs", async () => {
  const requiredEnvKeys = [
    "NOVA_SCHEDULER_TICK_MS",
    "NOVA_SCHEDULER_MAX_RUNS_PER_TICK",
    "NOVA_MISSION_QUALITY_MIN_SCORE",
    "NOVA_MISSION_QUALITY_MIN_WORDS",
    "NOVA_MISSION_QUALITY_DEBUG",
    "NOVA_LINK_FETCH_CACHE_TTL_MS",
    "NOVA_LINK_FETCH_CACHE_MAX",
    "NOVA_MEMORY_RECALL_TOP_K",
    "NOVA_MEMORY_MMR_LAMBDA",
    "NOVA_MEMORY_DECAY_HALF_LIFE_DAYS",
    "NOVA_TOOL_CAPABILITY_ENFORCE",
  ];
  for (const envKey of requiredEnvKeys) {
    assert.equal(envExample.includes(`${envKey}=`), true, `missing env key doc: ${envKey}`);
  }
});

await run("P20-C5 launcher paths stay stable and visible for operator debugging", async () => {
  assert.equal(launcherBat.includes("cd /d C:\\Nova"), true);
  assert.equal(launcherBat.includes("node nova.js"), true);
  assert.equal(launcherVbs.includes("cmd.exe /k"), true);
  assert.equal(launcherVbs.includes("cd /d C:\\Nova"), true);
  assert.equal(/logs?/i.test(launcherVbs), false, "launcher should not mention legacy logs directory logic");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
