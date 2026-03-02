/**
 * Audit — ensureStarterSkillsForUser error visibility (P4) + seeding correctness
 *
 * Bug (P4): The entire ensureStarterSkillsForUser body was wrapped in a bare
 * `try {} catch {}` — any failure (disk full, EROFS, permission denied) was
 * silently swallowed with no log or error surface. Users would get no skills
 * with zero diagnostic information.
 *
 * Fix (P4): catch block now logs via console.error with message + directory
 * (skills.js:659).
 *
 * Tests:
 *   A) ensureStarterSkillsForUser seeds skill directories into a fresh temp dir
 *   B) Called twice on the same dir — does not re-seed (idempotent, meta gate)
 *   C) Called with a non-existent path does not throw (errors are handled)
 *   D) Skills directory created at correct path inside personaWorkspaceDir
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureStarterSkillsForUser } from "../../../../src/runtime/modules/context/skills/index.js";

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-audit-seeding-"));

  try {
    // ── Test A: seeds skill directories into a fresh dir
    // ensureStarterSkillsForUser must not throw
    try {
      ensureStarterSkillsForUser(tmpDir);
    } catch (err) {
      assert.fail(`ensureStarterSkillsForUser must not throw. Error: ${err.message}`);
    }

    const skillsDir = path.join(tmpDir, "skills");
    assert.ok(
      fs.existsSync(skillsDir),
      `skills directory must be created at ${skillsDir}`,
    );

    // At least some skill directories should be created (if baseline skills exist)
    // or the meta file should be written indicating seeding was attempted
    const metaPath = path.join(skillsDir, ".meta.json");
    const hasMeta = fs.existsSync(metaPath);
    const entries = fs.existsSync(skillsDir)
      ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory())
      : [];

    // Either meta was written or skill dirs were created — one must be true
    assert.ok(
      hasMeta || entries.length > 0,
      `ensureStarterSkillsForUser must write .meta.json or create skill dirs. dir=${skillsDir}`,
    );

    if (hasMeta) {
      const raw = fs.readFileSync(metaPath, "utf8");
      const meta = JSON.parse(raw);
      assert.ok(
        typeof meta.startersInitialized === "boolean",
        `meta.startersInitialized must be a boolean. Got: ${JSON.stringify(meta)}`,
      );
    }

    // ── Test B: calling again on the same dir is idempotent (no re-seeding, no throw)
    const mtimesBefore = {};
    if (fs.existsSync(skillsDir)) {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
        if (fs.existsSync(skillFile)) {
          mtimesBefore[entry.name] = fs.statSync(skillFile).mtimeMs;
        }
      }
    }

    try {
      ensureStarterSkillsForUser(tmpDir);
    } catch (err) {
      assert.fail(`ensureStarterSkillsForUser must not throw on second call. Error: ${err.message}`);
    }

    // Files that existed before must not have their mtime changed (not re-written)
    for (const [name, mtimeBefore] of Object.entries(mtimesBefore)) {
      const skillFile = path.join(skillsDir, name, "SKILL.md");
      if (fs.existsSync(skillFile)) {
        const mtimeAfter = fs.statSync(skillFile).mtimeMs;
        assert.ok(
          mtimeAfter === mtimeBefore,
          `SKILL.md for "${name}" must not be re-written on second ensureStarterSkillsForUser call`,
        );
      }
    }

    // ── Test C: non-existent path does not throw
    const nonExistentDir = path.join(tmpDir, "does-not-exist", "nested");
    try {
      ensureStarterSkillsForUser(nonExistentDir);
    } catch (err) {
      assert.fail(
        `ensureStarterSkillsForUser must not throw on non-existent path. Error: ${err.message}`,
      );
    }

    // ── Test D: skills created at correct sub-path (personaWorkspaceDir/skills/)
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "nova-audit-seeding2-"));
    try {
      ensureStarterSkillsForUser(tmpDir2);
      const expectedSkillsDir = path.join(tmpDir2, "skills");
      // skills dir should be directly under the persona dir, not nested elsewhere
      assert.ok(
        fs.existsSync(expectedSkillsDir),
        `skills must be at personaWorkspaceDir/skills/, not elsewhere. Expected: ${expectedSkillsDir}`,
      );
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }

    console.log("PASS smoke/audit/starter-seeding");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(`FAIL smoke/audit/starter-seeding: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
