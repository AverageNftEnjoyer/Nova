/**
 * Audit P2 regression — newlines in user text are sanitized before storing as rule
 *
 * Bug: parseCryptoReportPreferenceDirectives pushed `rule: ${raw}` where `raw`
 * was unmodified user input. A message containing \n would write a literal
 * newline into SKILL.md, splitting one rule across two lines and causing the
 * second fragment to be parsed as a separate (malformed) directive.
 *
 * Fix: `raw.replace(/[\r\n]+/g, " ").trim()` before appending (crypto-fast-path.js:466).
 *
 * Tests:
 *   A) Preference message with embedded \n writes a single-line rule in SKILL.md
 *   B) Rule line contains no \n or \r characters
 *   C) The \r\n variant is also sanitized
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

async function run() {
  // Use a temp directory so we never pollute the real workspace
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-audit-p2-"));
  const userContextId = `audit-p2-${Date.now()}`;
  const conversationId = `conv-p2-${Date.now()}`;

  try {
    // ── Seed crypto affinity
    await tryCryptoFastPathReply({
      text: "show me my coinbase portfolio",
      runtimeTools,
      availableTools,
      userContextId,
      conversationId,
      workspaceDir: tmpDir,
    });

    // ── Test A/B: preference text with embedded \n (Unix)
    const prefTextLF = "always show 2 decimals in my coinbase report\nremember this going forward";
    await tryCryptoFastPathReply({
      text: prefTextLF,
      runtimeTools,
      availableTools,
      userContextId,
      conversationId,
      workspaceDir: tmpDir,
    });

    const skillPath = path.join(
      tmpDir,
      ".agent",
      "user-context",
      userContextId,
      "skills",
      "coinbase",
      "SKILL.md",
    );

    assert.ok(
      fs.existsSync(skillPath),
      `SKILL.md was not written to workspaceDir. Expected: ${skillPath}`,
    );

    const content = fs.readFileSync(skillPath, "utf8");
    const lines = content.split("\n");

    // Find rule lines
    const ruleLines = lines.filter((line) => /^rule\s*:/i.test(line.trim()));
    assert.ok(ruleLines.length >= 1, "Expected at least one rule: line in SKILL.md");

    for (const ruleLine of ruleLines) {
      assert.ok(
        !ruleLine.includes("\n") && !ruleLine.includes("\r"),
        `rule line must not contain raw newlines: ${JSON.stringify(ruleLine)}`,
      );
      // Verify the \n in the original was replaced with a space (not just dropped)
      if (ruleLine.includes("always show 2 decimals")) {
        assert.ok(
          ruleLine.includes("remember this going forward") || ruleLine.includes("remember"),
          `Both parts of the newline-split message should be on one line: ${ruleLine}`,
        );
      }
    }

    // ── Test C: \r\n variant
    const userContextId2 = `audit-p2b-${Date.now()}`;
    const conversationId2 = `conv-p2b-${Date.now()}`;

    await tryCryptoFastPathReply({
      text: "show me my coinbase portfolio",
      runtimeTools,
      availableTools,
      userContextId: userContextId2,
      conversationId: conversationId2,
      workspaceDir: tmpDir,
    });

    const prefTextCRLF = "always show 2 decimals in my coinbase report\r\nremember this going forward";
    await tryCryptoFastPathReply({
      text: prefTextCRLF,
      runtimeTools,
      availableTools,
      userContextId: userContextId2,
      conversationId: conversationId2,
      workspaceDir: tmpDir,
    });

    const skillPath2 = path.join(
      tmpDir,
      ".agent",
      "user-context",
      userContextId2,
      "skills",
      "coinbase",
      "SKILL.md",
    );

    if (fs.existsSync(skillPath2)) {
      const content2 = fs.readFileSync(skillPath2, "utf8");
      assert.ok(
        !content2.includes("\r\n"),
        "SKILL.md must not contain \\r\\n inside stored rule values",
      );
    }

    console.log("PASS smoke/audit/p2-rule-newline");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(`FAIL smoke/audit/p2-rule-newline: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
