import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadIntegrationsRuntime } from "./runtime.js";

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-runtime-gmail-"));
  fs.mkdirSync(path.join(root, "hud", "data"), { recursive: true });
  return root;
}

function writeIntegrationsConfig(
  workspaceRoot: string,
  userContextId: string,
  payload: Record<string, unknown>,
): void {
  const target = path.join(
    workspaceRoot,
    ".agent",
    "user-context",
    userContextId,
    "integrations-config.json",
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
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
    fs.rmSync(workspace, { recursive: true, force: true });
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
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
