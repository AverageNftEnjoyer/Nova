import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RESERVED_SRC_USER_SENTINEL,
  assertPathIsNotUnderReservedSrcUserPath,
  enforceWorkspaceUserStateInvariant,
} from "./workspace-user-root/index.js";

test("enforceWorkspaceUserStateInvariant creates the reserved src/.user sentinel file", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-src-user-sentinel-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "hud"), { recursive: true });
    const result = enforceWorkspaceUserStateInvariant(tmpRoot);
    assert.equal(result.workspaceRoot, tmpRoot);
    assert.equal(result.reservedSrcUserPath, path.join(tmpRoot, "src", ".user"));
    assert.equal(fs.statSync(result.reservedSrcUserPath).isFile(), true);
    assert.equal(fs.readFileSync(result.reservedSrcUserPath, "utf8"), RESERVED_SRC_USER_SENTINEL);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("enforceWorkspaceUserStateInvariant rejects duplicate src/.user directories", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-src-user-dup-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "src", ".user"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "hud"), { recursive: true });
    assert.throws(
      () => enforceWorkspaceUserStateInvariant(tmpRoot),
      /Invalid duplicate user state root detected/i,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("assertPathIsNotUnderReservedSrcUserPath rejects reserved src/.user children", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-src-user-path-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "hud"), { recursive: true });
    enforceWorkspaceUserStateInvariant(tmpRoot);
    assert.throws(
      () => assertPathIsNotUnderReservedSrcUserPath(path.join(tmpRoot, "src", ".user", "user-context"), tmpRoot, "userContextRoot"),
      /may not resolve under/i,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
