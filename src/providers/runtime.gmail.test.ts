import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDb, nowIso, resolveDataDir } from "../db/index.js";
import { loadIntegrationsRuntime } from "./runtime/index.js";

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-runtime-gmail-"));
  fs.mkdirSync(path.join(root, "hud", "data"), { recursive: true });
  // resolveWorkspaceRoot() only recognises a workspace that has both hud/ and src/.
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  return root;
}

// Runtime integrations now live in nova.db (integration_state 'runtime'/'snapshot', the row HUD's
// syncAgentRuntimeIntegrationsSnapshot writes), not in <workspace>/.user/**/integrations-config.json.
// The DB follows NOVA_DATA_DIR, so refuse to seed anything outside a throwaway dir.
const seededUserIds = new Set<string>();

function assertIsolatedDataDir(): void {
  const rel = path.relative(path.resolve(os.tmpdir()), path.resolve(resolveDataDir()));
  assert.ok(
    rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel),
    "test must run with NOVA_DATA_DIR under the OS temp dir (npm run test:node does this)",
  );
}

function writeIntegrationsConfig(
  _workspaceRoot: string,
  userContextId: string,
  payload: Record<string, unknown>,
): void {
  assertIsolatedDataDir();
  getDb()
    .prepare(
      `INSERT INTO integration_state (user_id, integration, key, value_json, expires_at, updated_at)
       VALUES (?, 'runtime', 'snapshot', ?, NULL, ?)
       ON CONFLICT(user_id, integration, key) DO UPDATE SET
         value_json = excluded.value_json, expires_at = NULL, updated_at = excluded.updated_at`,
    )
    .run(userContextId, JSON.stringify(payload), nowIso());
  seededUserIds.add(userContextId);
}

function removeWorkspace(workspace: string): void {
  // Snapshots must not leak between tests (the src and dist copies of this file share one DB).
  const remove = getDb().prepare("DELETE FROM integration_state WHERE user_id = ? AND integration = 'runtime' AND key = 'snapshot'");
  for (const userId of seededUserIds) remove.run(userId);
  seededUserIds.clear();
  fs.rmSync(workspace, { recursive: true, force: true });
}

test("loadIntegrationsRuntime keeps backward compatibility when gmail block is absent", () => {
  const workspace = makeWorkspace();
  try {
    writeIntegrationsConfig(workspace, "compat-user", {
      activeLlmProvider: "openai",
      openai: {
        connected: false,
      },
    });
    const runtime = loadIntegrationsRuntime({
      workspaceRoot: workspace,
      userContextId: "compat-user",
    });
    assert.equal(runtime.gmail.connected, false);
    assert.equal(runtime.gmail.activeAccountId, "");
    assert.equal(runtime.gmail.email, "");
    assert.deepEqual(runtime.gmail.scopes, []);
    assert.deepEqual(runtime.gmail.accounts, []);
  } finally {
    removeWorkspace(workspace);
  }
});

test("loadIntegrationsRuntime parses gmail block per userContextId without leakage", () => {
  const workspace = makeWorkspace();
  try {
    writeIntegrationsConfig(workspace, "user-a", {
      gmail: {
        connected: true,
        activeAccountId: "acct-a",
        email: "alice@example.com",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        accessToken: "plain-token-a",
        accounts: [
          {
            id: "acct-a",
            email: "alice@example.com",
            enabled: true,
            scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
            accessToken: "plain-token-a",
          },
        ],
      },
    });
    writeIntegrationsConfig(workspace, "user-b", {
      gmail: {
        connected: true,
        activeAccountId: "acct-b",
        email: "bob@example.com",
        scopes: ["https://www.googleapis.com/auth/gmail.modify"],
        accessToken: "plain-token-b",
        accounts: [
          {
            id: "acct-b",
            email: "bob@example.com",
            enabled: true,
            scopes: ["https://www.googleapis.com/auth/gmail.modify"],
            accessToken: "plain-token-b",
          },
        ],
      },
    });

    const runtimeA = loadIntegrationsRuntime({
      workspaceRoot: workspace,
      userContextId: "user-a",
    });
    const runtimeB = loadIntegrationsRuntime({
      workspaceRoot: workspace,
      userContextId: "user-b",
    });

    assert.equal(runtimeA.gmail.email, "alice@example.com");
    assert.equal(runtimeB.gmail.email, "bob@example.com");
    assert.notEqual(runtimeA.gmail.email, runtimeB.gmail.email);
    assert.equal(runtimeA.gmail.activeAccountId, "acct-a");
    assert.equal(runtimeB.gmail.activeAccountId, "acct-b");
    assert.equal(runtimeA.gmail.accessToken, "plain-token-a");
    assert.equal(runtimeB.gmail.accessToken, "plain-token-b");
    assert.equal(runtimeA.gmail.accounts[0]?.accessToken, "plain-token-a");
    assert.equal(runtimeB.gmail.accounts[0]?.accessToken, "plain-token-b");
  } finally {
    removeWorkspace(workspace);
  }
});
