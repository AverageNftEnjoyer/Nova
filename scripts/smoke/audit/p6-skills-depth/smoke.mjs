/**
 * Audit P6 regression — walkSkillFiles depth guard prevents infinite recursion
 *
 * Bug: walkSkillFiles in skills.js had no depth limit. A symlink cycle or
 * deeply nested directory would recurse until stack overflow. On some platforms
 * entry.isDirectory() returns true for symlinks pointing to directories.
 *
 * Fix: depth parameter added with guard `if (depth > 8) return` (skills.js:300).
 *
 * Tests:
 *   A) A 12-level deep directory with a SKILL.md at the bottom does not crash
 *      discoverRuntimeSkillsWithCache — completes and returns normally
 *   B) A valid skill at depth 1 IS discovered (guard doesn't break normal discovery)
 *   C) Skills beyond depth 8 are NOT discovered (guard is enforced)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverRuntimeSkillsWithCache } from "../../../../src/runtime/modules/context/skills.js";

const DEEP_SKILL_CONTENT = `---
name: deep-skill
description: A skill buried very deep in the directory tree.
---

# Deep Skill

## Activation
- Use when testing depth limits.

## Workflow
### 1. Execute
- Nothing to do.

### 3. Verification Before Done
- Confirm no stack overflow occurred.

## Completion Criteria
- Returned without error.
`;

const VALID_SKILL_CONTENT = `---
name: valid-skill
description: A normally placed skill at depth 1.
---

# Valid Skill

## Activation
- Use when the request matches this domain.

## Workflow
### 1. Execute
- Perform the work.

### 3. Verification Before Done
- Confirm the output is correct.

## Completion Criteria
- Output is complete and accurate.
`;

function buildDeepDir(baseDir, depth) {
  let current = baseDir;
  for (let i = 0; i < depth; i++) {
    current = path.join(current, `level-${i}`);
  }
  return current;
}

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-audit-p6-"));

  try {
    // ── Build a 12-level-deep directory tree with a SKILL.md at the bottom
    const deepLeaf = buildDeepDir(tmpDir, 12);
    fs.mkdirSync(deepLeaf, { recursive: true });
    fs.writeFileSync(path.join(deepLeaf, "SKILL.md"), DEEP_SKILL_CONTENT, "utf8");

    // ── Build a valid skill at depth 1 (skill-name/SKILL.md — expected pattern)
    const validSkillDir = path.join(tmpDir, "valid-skill");
    fs.mkdirSync(validSkillDir, { recursive: true });
    fs.writeFileSync(path.join(validSkillDir, "SKILL.md"), VALID_SKILL_CONTENT, "utf8");

    // ── Test A: discoverRuntimeSkillsWithCache must not throw or hang
    let skills;
    try {
      skills = discoverRuntimeSkillsWithCache([tmpDir]);
    } catch (err) {
      assert.fail(`discoverRuntimeSkillsWithCache threw on deep directory: ${err.message}`);
    }

    assert.ok(
      Array.isArray(skills),
      "discoverRuntimeSkillsWithCache must return an array even with deep directories",
    );

    // ── Test B: the valid skill at depth 1 should be discoverable
    const validFound = skills.some((s) => String(s?.name || "") === "valid-skill");
    assert.ok(validFound, `valid-skill at depth 1 must be discovered. Found: ${JSON.stringify(skills.map((s) => s?.name))}`);

    // ── Test C: the deep skill (depth 12, beyond guard of 8) must NOT be discovered
    // walkSkillFiles is called starting from tmpDir, so the leaf is at 12 levels deep.
    // With depth guard at 8, skills at level 9+ should be skipped.
    const deepFound = skills.some((s) => String(s?.name || "") === "deep-skill");
    assert.ok(
      !deepFound,
      "deep-skill at depth 12 must NOT be discovered — depth guard should prevent traversal beyond depth 8",
    );

    console.log("PASS smoke/audit/p6-skills-depth");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(`FAIL smoke/audit/p6-skills-depth: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
