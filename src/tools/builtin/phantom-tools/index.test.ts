import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDb, nowIso, resolveDataDir } from "../../../db/index.js";
import { createToolRegistry } from "../../core/registry/index.js";

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-phantom-tools-"));
  // resolveWorkspaceRoot() only recognises a workspace that has both hud/ and src/.
  fs.mkdirSync(path.join(root, "hud"), { recursive: true });
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

function writeRuntimeConfig(
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
    removeWorkspace(workspace);
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
	    removeWorkspace(workspace);
	  }
	});
