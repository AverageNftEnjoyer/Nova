#!/usr/bin/env node
// Closure 4 packaging step: stage the repo-root `src/` runtime (plus the compiled `dist/` shims it
// requires and its own `node_modules`) into hud/runtime-resources/, for electron-builder's
// `extraResources` to copy into the packaged app at <resourcesPath>/runtime-resources.
//
// Why a separate staged copy instead of pointing electron-builder straight at the repo root:
// electron-builder drops a directory literally named `node_modules` when it is the root of `from`
// (see hud/electron-builder.yml). Staging one level down keeps runtime-resources/node_modules, and
// the trimmed package.json ships production dependencies only.
//
// better-sqlite3 >=13 is N-API and ships a per-platform prebuild that loads in both plain Node and
// Electron. This script verifies that binary. It does not rebuild it, and it does not touch the
// repo-root node_modules used by `nova.js`. The Electron-ABI rebuild below runs only for an older
// better-sqlite3 that still has `gypfile: true` and no bundled prebuild.
//
// Run from hud/: `node scripts/prepare-runtime-resources.mjs` (wired into `electron:build`/`electron:build:win`).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hudDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(hudDir, "..");
const stagingRoot = path.join(hudDir, "runtime-resources");

function log(msg) {
  console.log(`[prepare-runtime-resources] ${msg}`);
}

function npmCmd() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function ensureAgentCoreBuild() {
  log("Building agent core (tsc + dist shims) from repo root...");
  execFileSync(npmCmd(), ["run", "build:agent-core"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const distRoot = path.join(repoRoot, "dist");
  if (!fs.existsSync(distRoot)) {
    throw new Error(`dist/ still missing at ${distRoot} after build:agent-core.`);
  }
}

function cleanStaging() {
  log(`Cleaning ${stagingRoot} ...`);
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });
}

function copyTree(from, to, label) {
  if (!fs.existsSync(from)) {
    throw new Error(`${label} not found at ${from}`);
  }
  log(`Copying ${label} (${from} -> ${to}) ...`);
  fs.cpSync(from, to, { recursive: true, dereference: true, force: true, errorOnExist: false });
}

function copyTreeIfPresent(from, to, label) {
  if (!fs.existsSync(from)) {
    log(`Skipping ${label} (not found at ${from}).`);
    return;
  }
  copyTree(from, to, label);
}

function writeTrimmedPackageJson() {
  const src = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const trimmed = {
    name: src.name,
    version: src.version,
    private: true,
    type: src.type,
    // Only runtime (never dev) dependencies ship: this file drives what a packaged install needs
    // on disk, not what a dev build needs.
    dependencies: src.dependencies || {},
  };
  fs.writeFileSync(path.join(stagingRoot, "package.json"), JSON.stringify(trimmed, null, 2) + "\n");
  log("Wrote trimmed runtime package.json.");
}

// Installs the production dependency closure of the repo-root package.json into the staging dir
// instead of copying the repo-root node_modules (which carries devDependencies such as typescript and
// @types/*, plus dev-only tooling, roughly doubling the staged size).
//
// The lockfile pins exact versions, so the staged tree matches what was tested. `--ignore-scripts` is
// safe here: better-sqlite3 >=13 ships a bundled N-API prebuild and has gypfile:false, so nothing
// needs an install-time build (and skipping scripts means no compiler/SDK is needed on the build
// machine). The full package.json (with devDependencies) is written first only so `npm ci` accepts
// the root lockfile as consistent; writeTrimmedPackageJson() overwrites it afterwards, and
// `--omit=dev` keeps the devDependencies from being installed at all.
function installProductionNodeModules() {
  const lockFile = path.join(repoRoot, "package-lock.json");
  if (!fs.existsSync(lockFile)) {
    throw new Error(`Root package-lock.json not found at ${lockFile}; cannot stage a reproducible production install.`);
  }
  fs.copyFileSync(path.join(repoRoot, "package.json"), path.join(stagingRoot, "package.json"));
  fs.copyFileSync(lockFile, path.join(stagingRoot, "package-lock.json"));
  const base = ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"];
  // Online first (authoritative). If the registry is unreachable, fall back to the npm cache so a
  // build on a plane still works, provided the cache holds every tarball.
  const attempts = [base, [...base, "--offline", "--prefer-offline"]];
  let lastError = null;
  for (const args of attempts) {
    try {
      log(`Running npm ${args.join(" ")} in ${stagingRoot} ...`);
      execFileSync(npmCmd(), args, { cwd: stagingRoot, stdio: "inherit", shell: process.platform === "win32" });
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      log(`npm ${args.join(" ")} failed (${err?.message || err}).`);
    }
  }
  if (lastError) throw lastError;
  fs.rmSync(path.join(stagingRoot, "package-lock.json"), { force: true });
  for (const forbidden of ["typescript", "@types/better-sqlite3", "@types/jsdom", "@types/turndown"]) {
    if (fs.existsSync(path.join(stagingRoot, "node_modules", forbidden))) {
      throw new Error(`staged node_modules contains dev-only ${forbidden}; the production install is not clean.`);
    }
  }
}

function resolveElectronVersion() {
  const electronPkgPath = path.join(hudDir, "node_modules", "electron", "package.json");
  if (!fs.existsSync(electronPkgPath)) {
    throw new Error(`Electron package.json not found at ${electronPkgPath}; run npm install in hud/ first.`);
  }
  return JSON.parse(fs.readFileSync(electronPkgPath, "utf8")).version;
}

async function rebuildBetterSqlite3ForElectron() {
  const electronVersion = resolveElectronVersion();
  const pkgDir = path.join(stagingRoot, "node_modules", "better-sqlite3");
  if (!fs.existsSync(pkgDir)) {
    throw new Error(`better-sqlite3 not found in staged node_modules at ${pkgDir}.`);
  }

  // better-sqlite3 >=13 moved to N-API (node-addon-api) and ships a bundled prebuilt binary per
  // platform/arch directly inside the package (prebuilds/win32-x64.node, ...), with `gypfile: false`
  // — by design, one binary is meant to work across Node AND Electron ABI versions without a
  // per-runtime rebuild at all (see WiseLibs/better-sqlite3 v13.0.0 release notes). Forcing a
  // node-gyp/@electron/rebuild pass on a package like this doesn't just waste time, it can actively
  // fail (node-gyp still needs a matching Windows SDK to *configure*, even though nothing needs
  // compiling) or produce a redundant compiled binary the package's own loader never uses. Detect
  // this and skip straight past the ABI-rebuild machinery below when it applies.
  const pkgMeta = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const bundledPrebuild = path.join(pkgDir, "prebuilds", "win32-x64.node");
  if (pkgMeta.gypfile === false && fs.existsSync(bundledPrebuild)) {
    log(`better-sqlite3 ${pkgMeta.version} ships a bundled N-API binary (${bundledPrebuild}) ` +
        `that is not ABI-pinned to Node vs. Electron — no rebuild needed for Electron ${electronVersion}.`);
    return;
  }

  log(`Rebuilding better-sqlite3 for Electron ${electronVersion}'s ABI (staged copy only; ` +
      `the repo-root node_modules used by dev stays on Node's ABI) ...`);

  // The repo-root node_modules' own `node-abi` (dragged along in the staged copy as a transitive
  // dependency of prebuild-install) can be too old to know a brand-new Electron release's ABI number
  // (seen in practice: it did not recognize Electron 44). hud's node_modules carries a newer one
  // (electron-builder depends on it directly) that does. node-abi is a pure lookup table with no
  // native code, so overwriting the staged copy with hud's is low-risk.
  const hudNodeAbiDir = path.join(hudDir, "node_modules", "node-abi");
  const stagedNodeAbiDir = path.join(stagingRoot, "node_modules", "node-abi");
  if (fs.existsSync(hudNodeAbiDir)) {
    fs.rmSync(stagedNodeAbiDir, { recursive: true, force: true });
    fs.cpSync(hudNodeAbiDir, stagedNodeAbiDir, { recursive: true, dereference: true });
    log("Replaced staged node-abi with hud's newer copy.");
  }

  // Preferred: better-sqlite3 ships prebuilt binaries fetched via `prebuild-install`, the same tool
  // `npm run db:fix-native` uses for the Node ABI. No compiler needed if a prebuild exists for this
  // Electron version/arch.
  try {
    const prebuildBin = path.join(stagingRoot, "node_modules", "prebuild-install", "bin.js");
    if (!fs.existsSync(prebuildBin)) throw new Error("prebuild-install not present in staged node_modules");
    execFileSync(process.execPath, [
      prebuildBin,
      "--runtime", "electron",
      "--target", electronVersion,
      "--arch", "x64",
      "--platform", "win32",
    ], { cwd: pkgDir, stdio: "inherit" });
    log("better-sqlite3 rebuilt via prebuild-install (electron runtime).");
    return;
  } catch (err) {
    log(`prebuild-install for electron runtime failed (${err?.message || err}); trying @electron/rebuild ...`);
  }

  // Fallback: @electron/rebuild (needs MSVC build tools + the matching Windows SDK if no prebuild is
  // published for this Electron version). electron-builder already depends on it, so it is normally
  // available at hud/node_modules/@electron/rebuild without hud needing its own devDependency on it
  // (electron-builder itself warns against adding a redundant direct one).
  let rebuildFn;
  try {
    const specifierPath = path.join(hudDir, "node_modules", "@electron", "rebuild", "lib", "main.js");
    if (!fs.existsSync(specifierPath)) throw new Error("@electron/rebuild not found in hud/node_modules (expected via electron-builder's own dependency)");
    ({ rebuild: rebuildFn } = await import(pathToFileURL(specifierPath).href));
  } catch (err) {
    throw new Error(
      `@electron/rebuild is not available and prebuild-install failed. Run \`npm install\` in hud/ ` +
      `(electron-builder depends on @electron/rebuild) and re-run, or install matching MSVC build tools ` +
      `and a matching Windows SDK. Original error: ${err?.message || err}`,
    );
  }

  await rebuildFn({
    buildPath: stagingRoot,
    electronVersion,
    arch: "x64",
    onlyModules: ["better-sqlite3"],
    force: true,
  });
  log("better-sqlite3 rebuilt via @electron/rebuild.");
}

// Turbopack (`next build`'s bundler here) resolves every `serverExternalPackages` entry (and some
// other externals, e.g. jsdom) to a content-hashed name and creates a symlink for it under
// `hud/.next/node_modules/<name>-<hash>` pointing at the real package — that symlink, sitting inside
// an ancestor directory of the compiled route chunks, is what makes their plain
// `require("<name>-<hash>")` calls resolve at all. Two problems for a packaged app: (1) the symlink
// target is an ABSOLUTE path on the machine that ran `next build`, meaningless on an end user's
// machine, and (2) electron-builder's file copier drops symlinks outright — confirmed by their total
// absence from `resources/app/.next/node_modules/` after packaging, which is what produced
// `Cannot find module 'better-sqlite3-<hash>'` at runtime for every DB-backed API route (the page
// shell still loaded fine; only routes that actually touch a `serverExternalPackages` entry broke,
// which is why this needed a real request, not just `next().prepare()`, to catch). Fix: replace each
// symlink with a real, self-contained copy of its target before electron-builder ever runs, so the
// packaged `.next/node_modules/<name>-<hash>` is an ordinary directory with no host-machine-specific
// path in it.
function dereferenceNextExternalSymlinks() {
  const nextNodeModules = path.join(hudDir, ".next", "node_modules");
  if (!fs.existsSync(nextNodeModules)) {
    log(`No ${nextNodeModules} — nothing to dereference (no serverExternalPackages symlinks this build).`);
    return;
  }
  const entries = fs.readdirSync(nextNodeModules, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(nextNodeModules, entry.name);
    const stat = fs.lstatSync(entryPath);
    if (!stat.isSymbolicLink()) continue;
    const target = fs.realpathSync(entryPath);
    log(`Dereferencing Next external symlink ${entry.name} -> ${target} ...`);
    // rmdirSync, not rmSync/unlinkSync: on Windows a directory symlink is a reparse point, and
    // rmdirSync on one removes only the reparse point itself, never descending into (or deleting
    // anything under) the real target directory. Verified in isolation before relying on it here —
    // this runs against the real repo-root node_modules/better-sqlite3 the dev workflow still uses.
    fs.rmdirSync(entryPath);
    fs.cpSync(target, entryPath, { recursive: true, dereference: true, force: true });
  }
}

async function main() {
  ensureAgentCoreBuild();
  dereferenceNextExternalSymlinks();
  cleanStaging();
  copyTree(path.join(repoRoot, "src"), path.join(stagingRoot, "src"), "src/");
  copyTree(path.join(repoRoot, "dist"), path.join(stagingRoot, "dist"), "dist/");
  // Repo-root siblings of src/ that ROOT_WORKSPACE_DIR-relative code expects to find (skills
  // baseline/starter catalog, mission/template starters) — see src/runtime/core/constants/index.js
  // and src/runtime/core/workspace-user-root/index.js's NOVA_WORKSPACE_ROOT override, which points
  // ROOT_WORKSPACE_DIR at this staged directory in the packaged app.
  copyTreeIfPresent(path.join(repoRoot, "skills"), path.join(stagingRoot, "skills"), "skills/");
  copyTreeIfPresent(path.join(repoRoot, "templates"), path.join(stagingRoot, "templates"), "templates/");
  installProductionNodeModules();
  writeTrimmedPackageJson();
  await rebuildBetterSqlite3ForElectron();
  log(`Done. Staged runtime resources at ${stagingRoot}`);
  log("NOTE: the staged better-sqlite3 binary above was NOT load-verified under a real Electron " +
      "process (this script runs under plain Node). Confirm on a real Windows machine by launching " +
      "the packaged app and creating an Agent Task before trusting this build.");
}

main().catch((err) => {
  console.error(`[prepare-runtime-resources] FAILED: ${err?.stack || err}`);
  process.exit(1);
});
