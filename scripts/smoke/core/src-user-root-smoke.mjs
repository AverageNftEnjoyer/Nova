import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
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
  // The sentinel is a tracked text file, so a Windows checkout may have CRLF line endings; compare LF-normalized.
  assert.equal(
    fs.readFileSync(invariant.reservedSrcUserPath, "utf8").replace(/\r\n/g, "\n"),
    workspaceRootModule.RESERVED_SRC_USER_SENTINEL,
  );
});

await run("Repo-root runtime constants never point at src/.user", async () => {
  assert.equal(constantsModule.ROOT_WORKSPACE_DIR, repoRoot);
  assertNoSrcUserPath(constantsModule.USER_CONTEXT_ROOT, "USER_CONTEXT_ROOT");
  assert.equal(
    String(constantsModule.USER_CONTEXT_ROOT || "").replace(/\//g, "\\"),
    // USER_CONTEXT_ROOT follows the data dir (NOVA_DATA_DIR here; <repo>/.user by default).
    path.join(process.env.NOVA_DATA_DIR || repoUserRoot, "user-context"),
  );
});

await run("Current runtime-owned state adapters stay in the user-scoped local store", async () => {
  // Voice settings and Telegram/Discord integration state are SQLite rows in nova.db (kv_state / integration_state),
  // addressed by `sqlite:` pseudo-paths that carry the user id, never by files under (src/).user.
  const telegram = telegramModule.createTelegramIntegrationStateAdapter();
  const discord = discordModule.createDiscordIntegrationStateAdapter();
  const expected = [
    [voiceSettingsModule.resolveVoiceUserSettingsStorePath("smoke-user"), "sqlite:kv_state/smoke-user/"],
    [telegram.buildScopedIntegrationsPath("smoke-user"), "sqlite:integration_state/smoke-user/"],
    [discord.buildScopedIntegrationsPath("smoke-user"), "sqlite:integration_state/smoke-user/"],
  ];
  for (const [resolvedPath, prefix] of expected) {
    assertNoSrcUserPath(resolvedPath, "runtime state path");
    assert.equal(
      String(resolvedPath || "").startsWith(prefix),
      true,
      `expected user-scoped ${prefix}* path, got ${resolvedPath}`,
    );
  }
  // Another user's path never collides with this one.
  assert.notEqual(
    voiceSettingsModule.resolveVoiceUserSettingsStorePath("smoke-user"),
    voiceSettingsModule.resolveVoiceUserSettingsStorePath("other-user"),
  );
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
    // The workspace root normalizes back to the repo root, but per-user state now follows the data dir
    // (NOVA_DATA_DIR here) and the integrations snapshot is a nova.db row, not <root>/hud/data/*.json.
    const dataDir = process.env.NOVA_DATA_DIR;
    assert.equal(runtimePaths.userContextRoot, path.join(dataDir, "user-context"));
    assert.equal(runtimePaths.integrationsConfigPath, "sqlite:integration_state/runtime/snapshot");
    assert.equal(coinbasePath, path.join(dataDir, "user-context", "smoke-user", "coinbase", "coinbase.sqlite"));
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
