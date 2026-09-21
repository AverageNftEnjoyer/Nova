import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDb, nowIso, resolveDataDir } from "../db/index.js";
import { loadIntegrationsRuntime } from "./runtime/index.js";

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-runtime-phantom-"));
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

test("loadIntegrationsRuntime keeps backward compatibility when phantom block is absent", () => {
  const workspace = makeWorkspace();
  try {
    writeIntegrationsConfig(workspace, "compat-user", {
      activeLlmProvider: "openai",
      openai: { connected: false },
    });
    const runtime = loadIntegrationsRuntime({
      workspaceRoot: workspace,
      userContextId: "compat-user",
    });
    assert.equal(runtime.phantom.connected, false);
    assert.equal(runtime.phantom.walletAddress, "");
    assert.equal(runtime.phantom.provider, "phantom");
    assert.equal(runtime.phantom.preferences.allowAgentWalletContext, true);
    assert.equal(runtime.phantom.preferences.allowAgentEvmContext, true);
  } finally {
    removeWorkspace(workspace);
  }
});

test("loadIntegrationsRuntime parses phantom block per userContextId without leakage", () => {
  const workspace = makeWorkspace();
  try {
    writeIntegrationsConfig(workspace, "wallet-a", {
      phantom: {
        connected: true,
        provider: "phantom",
        chain: "solana",
        walletAddress: "WalletA",
        walletLabel: "Wall...etA",
        connectedAt: "2026-03-06T15:00:00.000Z",
        verifiedAt: "2026-03-06T15:01:00.000Z",
        evmAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        evmLabel: "0xaa...aaaa",
        evmChainId: "0x89",
        evmConnectedAt: "2026-03-06T15:01:30.000Z",
        capabilities: {
          signMessage: true,
          walletOwnershipProof: true,
          solanaConnected: true,
          solanaVerified: true,
          evmAvailable: true,
          approvalGatedPolymarket: true,
          approvalGatedPolymarketReady: true,
          autonomousTrading: false,
        },
      },
    });
    writeIntegrationsConfig(workspace, "wallet-b", {
      phantom: {
        connected: true,
        provider: "phantom",
        chain: "solana",
        walletAddress: "WalletB",
        walletLabel: "Wall...etB",
        connectedAt: "2026-03-06T16:00:00.000Z",
        verifiedAt: "2026-03-06T16:01:00.000Z",
        evmAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        evmLabel: "0xbb...bbbb",
        evmChainId: "0x89",
        evmConnectedAt: "2026-03-06T16:01:30.000Z",
        capabilities: {
          signMessage: true,
          walletOwnershipProof: true,
          solanaConnected: true,
          solanaVerified: true,
          evmAvailable: true,
          approvalGatedPolymarket: true,
          approvalGatedPolymarketReady: true,
          autonomousTrading: false,
        },
      },
    });

    const runtimeA = loadIntegrationsRuntime({ workspaceRoot: workspace, userContextId: "wallet-a" });
    const runtimeB = loadIntegrationsRuntime({ workspaceRoot: workspace, userContextId: "wallet-b" });

    assert.equal(runtimeA.phantom.walletAddress, "WalletA");
    assert.equal(runtimeB.phantom.walletAddress, "WalletB");
    assert.notEqual(runtimeA.phantom.walletAddress, runtimeB.phantom.walletAddress);
    assert.equal(runtimeA.phantom.verifiedAt, "2026-03-06T15:01:00.000Z");
    assert.equal(runtimeB.phantom.verifiedAt, "2026-03-06T16:01:00.000Z");
	    assert.equal(runtimeA.phantom.evmAddress, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
	    assert.equal(runtimeB.phantom.evmAddress, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
	    assert.equal(runtimeA.phantom.capabilities.approvalGatedPolymarketReady, true);
      assert.equal(runtimeA.phantom.preferences.allowApprovalGatedPolymarket, true);
	  } finally {
	    removeWorkspace(workspace);
	  }
	});
