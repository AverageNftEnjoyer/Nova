import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createToolRegistry } from "../../core/registry/index.js";

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nova-phantom-tools-"));
}

function writeRuntimeConfig(workspaceRoot: string, userContextId: string, payload: Record<string, unknown>): void {
  const target = path.join(workspaceRoot, ".user", "user-context", userContextId, "state", "integrations-config.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
}

function parseJsonOutput(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw);
  assert.ok(parsed && typeof parsed === "object");
  return parsed as Record<string, unknown>;
}

test("tool registry includes phantom tools when enabled", () => {
  const workspace = makeWorkspace();
  try {
    const tools = createToolRegistry(
      {
        enabledTools: ["phantom_capabilities"],
        execApprovalMode: "ask",
        safeBinaries: [],
        webSearchProvider: "brave",
        webSearchApiKey: "",
      },
      { workspaceDir: workspace, memoryManager: null },
    );
    assert.ok(tools.some((tool) => tool.name === "phantom_capabilities"));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("phantom capabilities tool returns user-scoped verified wallet metadata", async () => {
  const workspace = makeWorkspace();
  try {
    writeRuntimeConfig(workspace, "user-a", {
      phantom: {
        connected: true,
        provider: "phantom",
        chain: "solana",
        walletAddress: "WalletA",
        walletLabel: "Wall...etA",
        connectedAt: "2026-03-06T15:00:00.000Z",
        verifiedAt: "2026-03-06T15:01:00.000Z",
        lastDisconnectedAt: "",
	        evmAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	        evmLabel: "0xaa...aaaa",
	        evmChainId: "0x89",
	        evmConnectedAt: "2026-03-06T15:01:30.000Z",
	        preferences: {
	          allowAgentWalletContext: true,
	          allowAgentEvmContext: true,
	          allowApprovalGatedPolymarket: true,
	        },
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
    writeRuntimeConfig(workspace, "user-b", {
      phantom: {
        connected: false,
        provider: "phantom",
        chain: "solana",
        walletAddress: "",
        walletLabel: "",
        connectedAt: "",
        verifiedAt: "",
        lastDisconnectedAt: "2026-03-06T15:30:00.000Z",
	        evmAddress: "",
	        evmLabel: "",
	        evmChainId: "",
	        evmConnectedAt: "",
	        preferences: {
	          allowAgentWalletContext: false,
	          allowAgentEvmContext: false,
	          allowApprovalGatedPolymarket: false,
	        },
	        capabilities: {
          signMessage: true,
          walletOwnershipProof: true,
          solanaConnected: false,
          solanaVerified: false,
          evmAvailable: false,
          approvalGatedPolymarket: true,
          approvalGatedPolymarketReady: false,
          autonomousTrading: false,
        },
      },
    });
    const tools = createToolRegistry(
      {
        enabledTools: ["phantom_capabilities"],
        execApprovalMode: "ask",
        safeBinaries: [],
        webSearchProvider: "brave",
        webSearchApiKey: "",
      },
      { workspaceDir: workspace, memoryManager: null },
    );
    const tool = tools.find((entry) => entry.name === "phantom_capabilities");
    assert.ok(tool);

    const aPayload = parseJsonOutput(await tool!.execute({ userContextId: "user-a" }));
    const bPayload = parseJsonOutput(await tool!.execute({ userContextId: "user-b" }));
    assert.equal(aPayload.ok, true);
    assert.equal(bPayload.ok, true);
    assert.equal((aPayload.data as Record<string, unknown>).walletAddress, "WalletA");
    assert.equal((bPayload.data as Record<string, unknown>).walletAddress, "");
	    assert.equal((aPayload.data as Record<string, unknown>).provider, "phantom");
	    assert.equal((bPayload.data as Record<string, unknown>).lastDisconnectedAt, "2026-03-06T15:30:00.000Z");
	    assert.equal((aPayload.data as Record<string, unknown>).evmAddress, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
	    assert.equal(((aPayload.data as Record<string, unknown>).capabilities as Record<string, unknown>).evmAvailable, true);
      assert.equal(((bPayload.data as Record<string, unknown>).preferences as Record<string, unknown>).allowAgentWalletContext, false);
	  } finally {
	    fs.rmSync(workspace, { recursive: true, force: true });
	  }
	});
