/**
 * Audit P5 regression - preference writes never depend on process.cwd() or the caller's workspaceDir
 *
 * Bug: upsertCryptoReportPreferences hardcoded `const workspaceRoot = process.cwd()`, so a preference could be
 * written to the wrong location and later reads from the correct path would find nothing.
 *
 * Storage contract (current): preferences are stored in SQLite `kv_state` keyed by user id
 * (namespace "skill-preferences", key "coinbase"). The location no longer varies with workspaceDir/cwd at all, which
 * removes the original failure mode. NOVA_DATA_DIR is a throwaway directory (see ../../lib/isolated-data-dir.mjs).
 *
 * Tests:
 *   A) A preference saved with workspaceDir=tmpDir1 is stored in kv_state for that user and the returned locator
 *      is the sqlite:kv_state path (not a filesystem path)
 *   B) The same user's row is shared regardless of which workspaceDir later writes pass (no per-workspace split)
 *      and nothing is written into either workspaceDir or process.cwd()
 *   C) A second user gets an isolated row, with no leak in either direction
 */

import "../../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { kvGet } from "../../../../src/db/index.js";
import { runCryptoRequest } from "../../../../src/runtime/modules/chat/workers/finance/crypto-service/index.js";
import { upsertCryptoReportPreferences } from "../../../../src/runtime/modules/chat/workers/finance/crypto-service/replies/index.js";

const availableTools = [
  { name: "coinbase_portfolio_report" },
  { name: "coinbase_portfolio_snapshot" },
  { name: "coinbase_spot_price" },
  { name: "coinbase_capabilities" },
];

const runtimeTools = {
  async executeToolUse(toolUse) {
    const name = String(toolUse?.name || "");
    if (name === "coinbase_capabilities") {
      return { content: JSON.stringify({ ok: true, capabilities: { status: "connected" }, checkedAtMs: Date.now() }) };
    }
    if (name === "coinbase_portfolio_report") {
      return {
        content: JSON.stringify({
          ok: true,
          source: "coinbase",
          report: {
            rendered: "Coinbase concise portfolio report\ndate: 02/22/2026",
            summary: { estimatedTotalUsd: 1000, valuedAssetCount: 1, nonZeroAssetCount: 1 },
          },
        }),
      };
    }
    return { content: JSON.stringify({ ok: false, errorCode: "UNKNOWN" }) };
  },
};

function storedRules(userContextId) {
  const stored = kvGet(userContextId, "skill-preferences", "coinbase");
  return Array.isArray(stored?.rules) ? stored.rules.map((rule) => String(rule)) : null;
}

async function savePreference({ text, userContextId, conversationId, workspaceDir }) {
  await runCryptoRequest({
    text: "show me my coinbase portfolio",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
    workspaceDir,
  });
  const result = await runCryptoRequest({ text, runtimeTools, availableTools, userContextId, conversationId, workspaceDir });
  assert.equal(result?.source, "preference", `expected a preference reply: ${JSON.stringify(result)}`);
}

async function run() {
  const tmpDir1 = fs.mkdtempSync(path.join(os.tmpdir(), "nova-audit-p5a-"));
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "nova-audit-p5b-"));
  const userContextId = `audit-p5-${Date.now()}`;
  const conversationId = `conv-p5-${Date.now()}`;
  const cwdUserDir = path.join(process.cwd(), ".user", "user-context", userContextId);

  try {
    // -- Test A: stored in kv_state for the user; the locator is sqlite:, not a file
    await savePreference({
      text: "always show 2 decimals in my coinbase report going forward",
      userContextId,
      conversationId,
      workspaceDir: tmpDir1,
    });
    const rules1 = storedRules(userContextId);
    assert.ok(rules1, "preference row must exist in kv_state for the user");
    assert.ok(
      rules1.some((rule) => rule.includes("always show 2 decimals")),
      `stored rules must include the saved preference: ${JSON.stringify(rules1)}`,
    );
    const direct = upsertCryptoReportPreferences({
      userContextId,
      workspaceDir: tmpDir2,
      directives: ["rule: keep it short"],
    });
    assert.equal(direct.ok, true);
    assert.equal(direct.filePath, `sqlite:kv_state/${userContextId}/skill-preferences/coinbase`);

    // -- Test B: one row per user regardless of workspaceDir; nothing on disk in workspaces/cwd
    const merged = storedRules(userContextId);
    assert.ok(merged.some((rule) => rule.includes("always show 2 decimals")), "earlier rule must survive a write from another workspaceDir");
    assert.ok(merged.includes("rule: keep it short"), "a write with another workspaceDir must land in the same row");
    assert.deepEqual(fs.readdirSync(tmpDir1), [], "nothing may be written into workspaceDir (tmpDir1)");
    assert.deepEqual(fs.readdirSync(tmpDir2), [], "nothing may be written into workspaceDir (tmpDir2)");
    assert.ok(!fs.existsSync(cwdUserDir), "nothing may be written under process.cwd()/.user for this user");

    // -- Test C: per-user isolation
    const userContextId2 = `audit-p5b-${Date.now()}`;
    await savePreference({
      text: "never show timestamps in my coinbase report going forward",
      userContextId: userContextId2,
      conversationId: `conv-p5b-${Date.now()}`,
      workspaceDir: tmpDir2,
    });
    const rules2 = storedRules(userContextId2);
    assert.ok(rules2, "second user must have its own preference row");
    assert.ok(!rules2.some((rule) => rule.includes("always show 2 decimals")), "second user must not see the first user's rules");
    assert.ok(!storedRules(userContextId).some((rule) => rule.includes("timestamps")), "first user must not see the second user's rules");

    console.log("PASS smoke/audit/p5-workspace-write");
  } finally {
    fs.rmSync(tmpDir1, { recursive: true, force: true });
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(`FAIL smoke/audit/p5-workspace-write: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
