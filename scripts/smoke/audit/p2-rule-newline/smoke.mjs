/**
 * Audit P2 regression - newlines in user text are sanitized before storing as a rule
 *
 * Bug: parseCryptoReportPreferenceDirectives pushed `rule: ${raw}` where `raw` was unmodified user input. A
 * message containing \n would split one rule across two lines, so the second fragment was parsed as a separate
 * (malformed) directive.
 *
 * Fix: `raw.replace(/[\r\n]+/g, " ").trim()` before appending (crypto-service/replies/index.js).
 *
 * Storage contract (current): coinbase report preferences live in SQLite `kv_state`
 * (user_id, namespace "skill-preferences", key "coinbase"), not in a SKILL.md file. NOVA_DATA_DIR is a throwaway
 * directory (see ../../lib/isolated-data-dir.mjs), so the real nova.db is never touched.
 *
 * Tests:
 *   A) A preference message with an embedded \n is stored as one single-line rule containing both fragments
 *   B) No stored rule contains \n or \r
 *   C) The \r\n variant is sanitized the same way
 *   D) Nothing is written into the caller's workspaceDir (no SKILL.md side file)
 */

import "../../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { kvGet } from "../../../../src/db/index.js";
import { runCryptoRequest } from "../../../../src/runtime/modules/chat/workers/finance/crypto-service/index.js";

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
  return Array.isArray(stored?.rules) ? stored.rules.map((rule) => String(rule)) : [];
}

async function savePreference({ text, userContextId, conversationId, workspaceDir }) {
  // Seed crypto affinity so the follow-up preference message is treated as report context.
  await runCryptoRequest({
    text: "show me my coinbase portfolio",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
    workspaceDir,
  });
  const result = await runCryptoRequest({ text, runtimeTools, availableTools, userContextId, conversationId, workspaceDir });
  assert.equal(result?.source, "preference", `message must be handled as a preference: ${JSON.stringify(result)}`);
}

async function run() {
  // workspaceDir is only a placeholder now; Test D asserts that nothing lands in it.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-audit-p2-"));
  const userContextId = `audit-p2-${Date.now()}`;
  const conversationId = `conv-p2-${Date.now()}`;

  try {
    // -- Test A/B: embedded \n (Unix)
    await savePreference({
      text: "always show 2 decimals in my coinbase report\nremember this going forward",
      userContextId,
      conversationId,
      workspaceDir: tmpDir,
    });
    const rules = storedRules(userContextId);
    assert.ok(rules.length >= 1, "Expected at least one stored rule in kv_state");
    for (const rule of rules) {
      assert.ok(/^rule:/i.test(rule), `stored rule must keep the "rule:" prefix: ${JSON.stringify(rule)}`);
      assert.ok(!/[\r\n]/.test(rule), `stored rule must not contain raw newlines: ${JSON.stringify(rule)}`);
    }
    const merged = rules.find((rule) => rule.includes("always show 2 decimals"));
    assert.ok(merged, `expected the "always show 2 decimals" rule to be stored: ${JSON.stringify(rules)}`);
    assert.ok(
      merged.includes("remember this going forward"),
      `both halves of the newline-split message must be on one line (newline replaced by a space): ${JSON.stringify(merged)}`,
    );

    // -- Test C: \r\n variant
    const userContextId2 = `audit-p2b-${Date.now()}`;
    await savePreference({
      text: "always show 2 decimals in my coinbase report\r\nremember this going forward",
      userContextId: userContextId2,
      conversationId: `conv-p2b-${Date.now()}`,
      workspaceDir: tmpDir,
    });
    const rules2 = storedRules(userContextId2);
    assert.ok(rules2.length >= 1, "Expected at least one stored rule for the CRLF variant");
    for (const rule of rules2) {
      assert.ok(!/[\r\n]/.test(rule), `CRLF rule must be sanitized: ${JSON.stringify(rule)}`);
    }
    assert.ok(rules2.some((rule) => rule.includes("remember this going forward")), "CRLF variant lost the second fragment");

    // -- Test D: SQLite is the only store; no markdown side file in workspaceDir
    assert.deepEqual(fs.readdirSync(tmpDir), [], "preferences must not be written into workspaceDir");

    console.log("PASS smoke/audit/p2-rule-newline");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(`FAIL smoke/audit/p2-rule-newline: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
