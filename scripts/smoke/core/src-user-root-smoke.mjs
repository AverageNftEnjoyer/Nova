import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const results = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const repoUserRoot = path.join(repoRoot, ".user");

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

function toModuleUrl(relativePath) {
  return pathToFileURL(path.join(repoRoot, relativePath)).href;
}

function assertNoSrcUserPath(value, label) {
  const normalized = String(value || "").replace(/\//g, "\\").toLowerCase();
  assert.equal(normalized.includes("\\src\\.user\\"), false, `${label} resolved to ${value}`);
}

const runtimeModule = await import(toModuleUrl("src/providers/runtime/index.js"));
const constantsModule = await import(toModuleUrl("src/runtime/core/constants/index.js"));
const workspaceRootModule = await import(toModuleUrl("src/runtime/core/workspace-user-root/index.js"));
const voiceSettingsModule = await import(toModuleUrl("src/runtime/modules/services/voice/user-settings/index.js"));
const telegramModule = await import(toModuleUrl("src/runtime/modules/services/telegram/integration-state/index.js"));
const discordModule = await import(toModuleUrl("src/runtime/modules/services/discord/integration-state/index.js"));
const coinbaseStoreModule = await import(toModuleUrl("dist/integrations/coinbase/store/index.js"));

await run("Repo root reserves src/.user as a file sentinel", async () => {
  const invariant = workspaceRootModule.enforceWorkspaceUserStateInvariant(repoRoot);
  const stat = fs.statSync(invariant.reservedSrcUserPath);
  assert.equal(stat.isFile(), true, `expected reserved sentinel file at ${invariant.reservedSrcUserPath}`);
  assert.equal(
    fs.readFileSync(invariant.reservedSrcUserPath, "utf8"),
    workspaceRootModule.RESERVED_SRC_USER_SENTINEL,
  );
});

await run("Repo-root runtime constants never point at src/.user", async () => {
  assert.equal(constantsModule.ROOT_WORKSPACE_DIR, repoRoot);
  assertNoSrcUserPath(constantsModule.USER_CONTEXT_ROOT, "USER_CONTEXT_ROOT");
  assert.equal(
    String(constantsModule.USER_CONTEXT_ROOT || "").replace(/\//g, "\\"),
    path.join(repoRoot, ".user", "user-context"),
  );
});

await run("Current runtime-owned state adapters stay under repo .user", async () => {
  const telegram = telegramModule.createTelegramIntegrationStateAdapter();
  const discord = discordModule.createDiscordIntegrationStateAdapter();
  const paths = [
    voiceSettingsModule.resolveVoiceUserSettingsStorePath("smoke-user"),
    telegram.buildScopedIntegrationsPath("smoke-user"),
    discord.buildScopedIntegrationsPath("smoke-user"),
  ];
  for (const resolvedPath of paths) {
    assertNoSrcUserPath(resolvedPath, "runtime state path");
    assert.equal(
      String(resolvedPath || "").replace(/\//g, "\\").startsWith(repoUserRoot.replace(/\//g, "\\")),
      true,
      `expected repo-scoped .user path, got ${resolvedPath}`,
    );
  }
});

await run("Provided src workspace roots normalize back to repo root", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-user-root-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "hud", "data"), { recursive: true });
    const invariant = workspaceRootModule.enforceWorkspaceUserStateInvariant(tmpRoot);
    const runtimePaths = runtimeModule.resolveRuntimePaths(path.join(tmpRoot, "src"));
    const coinbasePath = coinbaseStoreModule.coinbaseDbPathForUserContext("smoke-user", path.join(tmpRoot, "src"));
    assert.equal(invariant.reservedSrcUserPath, path.join(tmpRoot, "src", ".user"));
    assert.equal(fs.statSync(invariant.reservedSrcUserPath).isFile(), true);
    assert.equal(runtimePaths.workspaceRoot, tmpRoot);
    assert.equal(runtimePaths.userContextRoot, path.join(tmpRoot, ".user", "user-context"));
    assert.equal(runtimePaths.integrationsConfigPath, path.join(tmpRoot, "hud", "data", "integrations-config.json"));
    assert.equal(coinbasePath, path.join(tmpRoot, ".user", "user-context", "smoke-user", "coinbase", "coinbase.sqlite"));
    assertNoSrcUserPath(runtimePaths.userContextRoot, "runtimePaths.userContextRoot");
    assertNoSrcUserPath(coinbasePath, "coinbase path");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

await run("Reserved src/.user sentinel blocks nested user-state targets", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-user-root-reserved-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "hud"), { recursive: true });
    workspaceRootModule.enforceWorkspaceUserStateInvariant(tmpRoot);
    assert.throws(
      () => workspaceRootModule.assertPathIsNotUnderReservedSrcUserPath(
        path.join(tmpRoot, "src", ".user", "user-context"),
        tmpRoot,
        "userContextRoot",
      ),
      /may not resolve under/i,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

await run("Duplicate src/.user roots are rejected", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-user-root-dup-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "src", ".user"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "hud", "data"), { recursive: true });
    let threw = false;
    try {
      runtimeModule.resolveRuntimePaths(tmpRoot);
    } catch (error) {
      threw = true;
      assert.match(String(error instanceof Error ? error.message : error), /Invalid duplicate user state root detected/i);
    }
    assert.equal(threw, true, "expected duplicate src/.user guard to throw");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

const failCount = results.filter((result) => result.status === "FAIL").length;
console.log(`\nSummary: pass=${results.length - failCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
