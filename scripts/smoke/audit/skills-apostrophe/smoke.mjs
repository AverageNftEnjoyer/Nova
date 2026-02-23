/**
 * Audit — parseInlineFrontmatterArray apostrophe handling
 *
 * Bug: parseInlineFrontmatterArray in skills.js does:
 *   JSON.parse(trimmed.replace(/'/g, '"'))
 * Any value containing a real apostrophe ("don't", "it's") becomes invalid
 * JSON after replacement ("don"t", "it"s") and silently returns [].
 *
 * This is a data-loss bug: skill read_when hints with apostrophes vanish
 * during discovery, causing the skill to appear without activation hints.
 *
 * Note: the fix is NOT in scope for the current patch plan (this is the
 * [LOW] finding — fix requires a YAML parser). This test documents the
 * current behavior (returns []) so a future regression to something WORSE
 * (e.g. throwing, corrupting other values) is caught.
 *
 * Tests:
 *   A) extractSkillMetadata does not throw on skill content with apostrophes
 *   B) description is still extracted correctly even when read_when has apostrophes
 *   C) A valid skill with double-quoted JSON array in read_when works correctly
 */

import assert from "node:assert/strict";
import { extractSkillMetadata } from "../../../../src/runtime/modules/context/skills.js";

const SKILL_WITH_APOSTROPHE_READWHEN = `---
name: test-skill
description: A skill for testing apostrophe handling.
metadata:
  read_when: ["when user says don't", "it's about crypto", "remind me"]
---

# Test Skill

## Activation
- Use when requested.

## Workflow
### 1. Execute
- Do the work.

### 3. Verification Before Done
- Check outcome.

## Completion Criteria
- Done.
`;

const SKILL_WITH_VALID_READWHEN = `---
name: valid-hints
description: Skill with correctly quoted read_when hints.
metadata:
  read_when: ["when user asks about portfolio", "crypto report request", "show balances"]
---

# Valid Hints Skill

## Activation
- Use when portfolio or crypto is requested.

## Workflow
### 1. Execute
- Run the portfolio report.

### 3. Verification Before Done
- Verify data is fresh.

## Completion Criteria
- Report returned without error.
`;

const SKILL_WITH_INLINE_APOSTROPHE = `---
name: inline-apostrophe
description: Skill using top-level read_when with apostrophe value.
read_when: ["user's portfolio", "don't show timestamps"]
---

# Inline Apostrophe Skill

## Activation
- Use when the user's portfolio is relevant.

## Workflow
### 1. Execute
- Show the portfolio.

### 3. Verification Before Done
- Confirm output is clean.

## Completion Criteria
- Portfolio displayed.
`;

async function run() {
  // ── Test A: no throw on apostrophe-containing skill content
  let metaWithApostrophe;
  try {
    metaWithApostrophe = extractSkillMetadata(SKILL_WITH_APOSTROPHE_READWHEN);
  } catch (err) {
    assert.fail(`extractSkillMetadata must not throw on apostrophe in read_when. Error: ${err.message}`);
  }

  assert.ok(
    metaWithApostrophe !== null && metaWithApostrophe !== undefined,
    "extractSkillMetadata must return a value even with apostrophe-containing read_when",
  );

  // ── Test B: description is still extracted correctly
  assert.ok(
    String(metaWithApostrophe?.description || "").includes("apostrophe"),
    `description should be extracted even when read_when has issues. Got: ${JSON.stringify(metaWithApostrophe?.description)}`,
  );

  // ── Test C: valid double-quoted JSON array in read_when works fully
  let metaValid;
  try {
    metaValid = extractSkillMetadata(SKILL_WITH_VALID_READWHEN);
  } catch (err) {
    assert.fail(`extractSkillMetadata must not throw on valid read_when. Error: ${err.message}`);
  }

  assert.ok(Array.isArray(metaValid?.readWhen), "readWhen must be an array for valid skill");
  assert.ok(
    metaValid.readWhen.length >= 1,
    `valid read_when hints should be extracted. Got: ${JSON.stringify(metaValid.readWhen)}`,
  );
  assert.ok(
    metaValid.readWhen.some((hint) => String(hint).includes("portfolio")),
    `"portfolio" hint should be in readWhen. Got: ${JSON.stringify(metaValid.readWhen)}`,
  );

  // ── Test D: inline top-level apostrophe-containing read_when doesn't crash either
  let metaInline;
  try {
    metaInline = extractSkillMetadata(SKILL_WITH_INLINE_APOSTROPHE);
  } catch (err) {
    assert.fail(`extractSkillMetadata must not throw on inline apostrophe read_when. Error: ${err.message}`);
  }
  assert.ok(metaInline !== null && metaInline !== undefined);
  assert.ok(
    String(metaInline?.description || "").includes("apostrophe"),
    `description must still be extracted on inline apostrophe skill`,
  );

  console.log("PASS smoke/audit/skills-apostrophe");
}

run().catch((err) => {
  console.error(`FAIL smoke/audit/skills-apostrophe: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
