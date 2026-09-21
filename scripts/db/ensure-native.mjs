#!/usr/bin/env node
/**
 * Verifies better-sqlite3's native binding loads on this Node version.
 *   node scripts/db/ensure-native.mjs         check only (used by nova.js at startup; never touches the network)
 *   node scripts/db/ensure-native.mjs --fix   fetch the prebuilt binary (one-time download from the
 *                                             better-sqlite3 GitHub release), falling back to `npm rebuild`
 * `npm ci --ignore-scripts` skips the package's own install step, which is how the binding goes missing.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export const FIX_COMMAND = "npm run db:fix-native";

export function checkNativeSqlite() {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    try {
      const version = db.prepare("SELECT sqlite_version() AS v").get().v;
      return { ok: true, sqliteVersion: String(version) };
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { ok: false, error: message, fix: FIX_COMMAND };
  }
}

function fixNativeSqlite() {
  const pkgDir = path.dirname(require.resolve("better-sqlite3/package.json"));
  try {
    const prebuildBin = require.resolve("prebuild-install/bin.js", { paths: [pkgDir] });
    execFileSync(process.execPath, [prebuildBin, "--runtime", "node"], { cwd: pkgDir, stdio: "inherit" });
    return;
  } catch {
    console.error("[db] prebuilt binary download failed; trying `npm rebuild better-sqlite3` (needs MSVC build tools).");
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npm, ["rebuild", "better-sqlite3"], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const wantsFix = process.argv.includes("--fix");
  let result = checkNativeSqlite();
  if (!result.ok && wantsFix) {
    try {
      fixNativeSqlite();
    } catch (error) {
      console.error(`[db] fix failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    result = checkNativeSqlite();
  }
  if (result.ok) {
    console.log(`[db] better-sqlite3 OK (SQLite ${result.sqliteVersion}, Node ${process.version}, ABI ${process.versions.modules}).`);
  } else {
    console.error(`[db] better-sqlite3 cannot load: ${result.error}`);
    console.error(`[db] Fix: run \`${FIX_COMMAND}\` (downloads the prebuilt binary once), or \`npm rebuild better-sqlite3\` (needs MSVC build tools).`);
    console.error("[db] Do not install with --ignore-scripts; that skips the native build.");
    process.exit(1);
  }
}
