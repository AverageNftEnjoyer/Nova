import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildPersonaPrompt as buildLegacyPersonaPrompt } from "../../src/runtime/modules/context/bootstrap.js";

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

const personaWorkspaceModule = await import(
  pathToFileURL(path.join(process.cwd(), "dist", "agent", "persona-workspace.js")).href
);
const bootstrapModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "agent", "bootstrap.js")).href);
const systemPromptModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "agent", "system-prompt.js")).href);

const { resolvePersonaWorkspaceDir } = personaWorkspaceModule;
const { discoverBootstrapFiles } = bootstrapModule;
const { buildSystemPrompt } = systemPromptModule;

async function createWorkspace() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-persona-smoke-"));
  const userContextRoot = path.join(root, ".agent", "user-context");
  const templatesDir = path.join(root, "templates");
  await fsp.mkdir(userContextRoot, { recursive: true });
  await fsp.mkdir(templatesDir, { recursive: true });
  return { root, userContextRoot, templatesDir };
}

function buildSrcPrompt(workspacePath, bootstrapFiles) {
  return buildSystemPrompt({
    mode: "full",
    workspacePath,
    tools: [],
    skills: [],
    bootstrapFiles,
    memoryEnabled: false,
    timezone: "America/New_York",
  });
}

await run("P4-C1: src persona files load from user-context path (no root fallback)", async () => {
  const ws = await createWorkspace();
  await fsp.writeFile(path.join(ws.root, "SOUL.md"), "ROOT_SOUL_SHOULD_NOT_APPEAR", "utf8");

  const userDir = path.join(ws.userContextRoot, "user-a");
  await fsp.mkdir(userDir, { recursive: true });
  await fsp.writeFile(path.join(userDir, "SOUL.md"), "USER_A_SOUL", "utf8");
  await fsp.writeFile(path.join(userDir, "USER.md"), "USER_A_PROFILE", "utf8");

  const personaDir = resolvePersonaWorkspaceDir({
    workspaceRoot: ws.root,
    userContextRoot: ws.userContextRoot,
    userContextId: "user-a",
  });
  const files = discoverBootstrapFiles(personaDir);
  const prompt = buildSrcPrompt(ws.root, files);

  assert.equal(path.resolve(personaDir), path.resolve(userDir));
  assert.equal(prompt.includes("USER_A_SOUL"), true);
  assert.equal(prompt.includes("USER_A_PROFILE"), true);
  assert.equal(prompt.includes("ROOT_SOUL_SHOULD_NOT_APPEAR"), false);
});

await run("P4-C2: template-only seeding behavior preserved", async () => {
  const ws = await createWorkspace();
  await fsp.writeFile(path.join(ws.templatesDir, "SOUL.md"), "TEMPLATE_SOUL", "utf8");
  await fsp.writeFile(path.join(ws.templatesDir, "USER.md"), "TEMPLATE_USER", "utf8");
  await fsp.writeFile(path.join(ws.root, "SOUL.md"), "ROOT_SOUL_SHOULD_NOT_BE_USED", "utf8");

  const seededDir = resolvePersonaWorkspaceDir({
    workspaceRoot: ws.root,
    userContextRoot: ws.userContextRoot,
    userContextId: "seeded-user",
  });
  const seededSoulPath = path.join(seededDir, "SOUL.md");
  const seededUserPath = path.join(seededDir, "USER.md");
  assert.equal(fs.existsSync(seededSoulPath), true);
  assert.equal(fs.existsSync(seededUserPath), true);
  assert.equal(fs.readFileSync(seededSoulPath, "utf8").includes("TEMPLATE_SOUL"), true);

  const anonDir = resolvePersonaWorkspaceDir({
    workspaceRoot: ws.root,
    userContextRoot: ws.userContextRoot,
    userContextId: "",
  });
  assert.equal(path.basename(anonDir), "anonymous");
  assert.equal(fs.existsSync(path.join(anonDir, "SOUL.md")), false);
});

await run("P4-C2: persona prompt composition parity (sample intent)", async () => {
  const ws = await createWorkspace();
  const userDir = path.join(ws.userContextRoot, "user-a");
  await fsp.mkdir(userDir, { recursive: true });
  await fsp.writeFile(path.join(userDir, "SOUL.md"), "SOUL_INTENT_MARKER", "utf8");
  await fsp.writeFile(path.join(userDir, "USER.md"), "USER_INTENT_MARKER", "utf8");
  await fsp.writeFile(path.join(userDir, "MEMORY.md"), "MEMORY_INTENT_MARKER", "utf8");
  await fsp.writeFile(path.join(userDir, "IDENTITY.md"), "IDENTITY_INTENT_MARKER", "utf8");

  const personaDir = resolvePersonaWorkspaceDir({
    workspaceRoot: ws.root,
    userContextRoot: ws.userContextRoot,
    userContextId: "user-a",
  });
  const srcPrompt = buildSrcPrompt(ws.root, discoverBootstrapFiles(personaDir));
  const legacyPrompt = buildLegacyPersonaPrompt(personaDir).prompt;

  for (const token of [
    "SOUL_INTENT_MARKER",
    "USER_INTENT_MARKER",
    "MEMORY_INTENT_MARKER",
    "IDENTITY_INTENT_MARKER",
  ]) {
    assert.equal(srcPrompt.includes(token), true, `src prompt missing token ${token}`);
    assert.equal(legacyPrompt.includes(token), true, `legacy prompt missing token ${token}`);
  }
});

await run("P4-C3: no cross-user persona leakage", async () => {
  const ws = await createWorkspace();
  const userADir = path.join(ws.userContextRoot, "user-a");
  const userBDir = path.join(ws.userContextRoot, "user-b");
  await fsp.mkdir(userADir, { recursive: true });
  await fsp.mkdir(userBDir, { recursive: true });
  await fsp.writeFile(path.join(userADir, "USER.md"), "ALPHA_PROFILE_TOKEN", "utf8");
  await fsp.writeFile(path.join(userBDir, "USER.md"), "BETA_PROFILE_TOKEN", "utf8");

  const aDir = resolvePersonaWorkspaceDir({
    workspaceRoot: ws.root,
    userContextRoot: ws.userContextRoot,
    userContextId: "user-a",
  });
  const bDir = resolvePersonaWorkspaceDir({
    workspaceRoot: ws.root,
    userContextRoot: ws.userContextRoot,
    userContextId: "user-b",
  });

  const promptA = buildSrcPrompt(ws.root, discoverBootstrapFiles(aDir));
  const promptB = buildSrcPrompt(ws.root, discoverBootstrapFiles(bDir));

  assert.equal(promptA.includes("ALPHA_PROFILE_TOKEN"), true);
  assert.equal(promptA.includes("BETA_PROFILE_TOKEN"), false);
  assert.equal(promptB.includes("BETA_PROFILE_TOKEN"), true);
  assert.equal(promptB.includes("ALPHA_PROFILE_TOKEN"), false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
