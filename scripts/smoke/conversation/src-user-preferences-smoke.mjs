import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

const moduleRef = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/context/user-preferences/index.js")).href
);

const {
  captureUserPreferencesFromMessage,
  buildUserPreferencePromptSection,
  loadUserPreferences,
} = moduleRef;

await run("Persists preferred name from inline call-me phrase", async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-pref-smoke-"));
  const first = captureUserPreferencesFromMessage({
    userContextId: "u1",
    workspaceDir: workspace,
    userInputText: "For this smoke test, call me Alex and reply with exactly Acknowledged.",
    nlpConfidence: 1,
    source: "hud",
    sessionKey: "agent:nova:hud:user:u1:dm:c1",
  });
  assert.equal(first.preferences.preferredName, "Alex");
  assert.equal(first.updatedKeys.includes("preferredName"), true);
});

await run("Scoped call-me suffixes are trimmed to a clean preferred name", async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-pref-smoke-"));
  const first = captureUserPreferencesFromMessage({
    userContextId: "u1b",
    workspaceDir: workspace,
    userInputText: "Call me Alex for this chat.",
    nlpConfidence: 1,
    source: "hud",
    sessionKey: "agent:nova:hud:user:u1b:dm:c1",
  });
  assert.equal(first.preferences.preferredName, "Alex");
});

await run("Low-confidence updates do not override explicit preferred name", async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-pref-smoke-"));
  captureUserPreferencesFromMessage({
    userContextId: "u2",
    workspaceDir: workspace,
    userInputText: "Call me Alex.",
    nlpConfidence: 1,
  });
  const lowConfidenceAttempt = captureUserPreferencesFromMessage({
    userContextId: "u2",
    workspaceDir: workspace,
    userInputText: "Call me Jordan.",
    nlpConfidence: 0.32,
  });
  assert.equal(lowConfidenceAttempt.preferences.preferredName, "Alex");
  assert.equal(Array.isArray(lowConfidenceAttempt.ignoredSignals), true);
  assert.equal(lowConfidenceAttempt.ignoredSignals.length > 0, true);
});

await run("High-confidence explicit update can change preferred name", async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-pref-smoke-"));
  captureUserPreferencesFromMessage({
    userContextId: "u3",
    workspaceDir: workspace,
    userInputText: "Call me Alex.",
    nlpConfidence: 1,
  });
  const update = captureUserPreferencesFromMessage({
    userContextId: "u3",
    workspaceDir: workspace,
    userInputText: "Actually call me Jamie.",
    nlpConfidence: 1,
  });
  assert.equal(update.preferences.preferredName, "Jamie");
});

await run("A newer explicit my-name statement overrides stale call-me aliases", async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-pref-smoke-"));
  captureUserPreferencesFromMessage({
    userContextId: "u3b",
    workspaceDir: workspace,
    userInputText: "Call me Alex.",
    nlpConfidence: 1,
  });
  const update = captureUserPreferencesFromMessage({
    userContextId: "u3b",
    workspaceDir: workspace,
    userInputText: "My name is Jack.",
    nlpConfidence: 1,
    source: "memory_update",
  });
  assert.equal(update.preferences.preferredName, "Jack");
});

await run("Falls back to MEMORY.md preferred-name marker for migration continuity", async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-pref-smoke-"));
  await fsp.writeFile(
    path.join(workspace, "MEMORY.md"),
    [
      "# Persistent Memory",
      "",
      "## Important Facts",
      "- 2026-02-21: [memory:preferred-name] My preferred name is Alex",
    ].join("\n"),
    "utf8",
  );
  const hydrated = captureUserPreferencesFromMessage({
    userContextId: "u4",
    workspaceDir: workspace,
    userInputText: "",
    nlpConfidence: 1,
  });
  assert.equal(hydrated.preferences.preferredName, "Alex");
  const reloaded = loadUserPreferences({ userContextId: "u4", workspaceDir: workspace });
  assert.equal(String(reloaded.preferences.fields?.preferredName?.value || ""), "Alex");
});

await run("Builds stable prompt section from preferred name", async () => {
  const section = buildUserPreferencePromptSection({ preferredName: "Alex" });
  assert.equal(section.includes("Preferred user name: Alex"), true);
  assert.equal(section.includes("Do not replace this name"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
