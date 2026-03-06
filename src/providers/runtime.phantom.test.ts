import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadIntegrationsRuntime } from "./runtime/index.js";

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-runtime-phantom-"));
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
    ".user",
    "user-context",
    userContextId,
    "state",
    "integrations-config.json",
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
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
    fs.rmSync(workspace, { recursive: true, force: true });
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
	    fs.rmSync(workspace, { recursive: true, force: true });
	  }
	});
