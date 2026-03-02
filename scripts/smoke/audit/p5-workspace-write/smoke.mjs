/**
 * Audit P5 regression — upsertCryptoReportPreferences writes to workspaceDir, not process.cwd()
 *
 * Bug: upsertCryptoReportPreferences hardcoded `const workspaceRoot = process.cwd()`.
 * If the caller knew the correct workspace (e.g. a user's persona dir), the pref was
 * written to the wrong location. Future reads from the correct path would find nothing.
 *
 * Fix: workspaceDir is now threaded from tryCryptoFastPathReply → upsertCryptoReportPreferences
 * (crypto-fast-path.js:474-477, chat-handler.js call sites).
 *
 * Tests:
 *   A) With workspaceDir set to tempDir, SKILL.md is written inside tempDir
 *   B) SKILL.md is NOT written inside process.cwd() (different path entirely)
 *   C) A second distinct workspaceDir produces a file in the second dir, not the first
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tryCryptoFastPathReply } from "../../../../src/runtime/modules/chat/fast-path/crypto-fast-path/index.js";

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

function skillPathFor(workspaceDir, userContextId) {
  return path.join(
    workspaceDir,
    ".agent",
    "user-context",
    userContextId,
    "skills",
    "coinbase",
    "SKILL.md",
  );
}

async function run() {
  const tmpDir1 = fs.mkdtempSync(path.join(os.tmpdir(), "nova-audit-p5a-"));
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "nova-audit-p5b-"));
  const userContextId = `audit-p5-${Date.now()}`;
  const conversationId = `conv-p5-${Date.now()}`;

  try {
    // ── Seed crypto affinity
    await tryCryptoFastPathReply({
      text: "show me my coinbase portfolio",
      runtimeTools,
      availableTools,
      userContextId,
      conversationId,
      workspaceDir: tmpDir1,
    });

    // ── Preference message routed to tmpDir1
    await tryCryptoFastPathReply({
      text: "always show 2 decimals in my coinbase report going forward",
      runtimeTools,
      availableTools,
      userContextId,
      conversationId,
      workspaceDir: tmpDir1,
    });

    const skillInTmp1 = skillPathFor(tmpDir1, userContextId);
    const skillInTmp2 = skillPathFor(tmpDir2, userContextId);

    // ── Test A: file written to the correct tmpDir1
    assert.ok(
      fs.existsSync(skillInTmp1),
      `SKILL.md must be written to workspaceDir (tmpDir1). Expected: ${skillInTmp1}`,
    );

    // ── Test B: file NOT written to tmpDir2 (or process.cwd())
    assert.ok(
      !fs.existsSync(skillInTmp2),
      `SKILL.md must NOT be written to tmpDir2 — indicates wrong workspace used`,
    );

    const skillInCwd = skillPathFor(process.cwd(), userContextId);
    assert.ok(
      !fs.existsSync(skillInCwd),
      `SKILL.md must NOT be written to process.cwd() — P5 bug would write here`,
    );

    // ── Test C: second workspace dir gets its own isolated file
    const userContextId2 = `audit-p5b-${Date.now()}`;
    const conversationId2 = `conv-p5b-${Date.now()}`;

    await tryCryptoFastPathReply({
      text: "show me my coinbase portfolio",
      runtimeTools,
      availableTools,
      userContextId: userContextId2,
      conversationId: conversationId2,
      workspaceDir: tmpDir2,
    });

    await tryCryptoFastPathReply({
      text: "never show timestamps in my coinbase report going forward",
      runtimeTools,
      availableTools,
      userContextId: userContextId2,
      conversationId: conversationId2,
      workspaceDir: tmpDir2,
    });

    const skillForUser2InTmp2 = skillPathFor(tmpDir2, userContextId2);
    const skillForUser2InTmp1 = skillPathFor(tmpDir1, userContextId2);

    assert.ok(
      fs.existsSync(skillForUser2InTmp2),
      `SKILL.md for user2 must be in tmpDir2. Expected: ${skillForUser2InTmp2}`,
    );
    assert.ok(
      !fs.existsSync(skillForUser2InTmp1),
      `SKILL.md for user2 must NOT be in tmpDir1 — workspaceDir leak`,
    );

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
