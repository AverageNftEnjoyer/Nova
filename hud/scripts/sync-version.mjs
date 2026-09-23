// Keeps every package version in step with NOVA_VERSION ("V.68 Alpha" -> 0.68.0):
//   hud/package.json  (+ lockfile)  what electron-builder names the installer with and electron-updater
//                                   compares against GitHub Releases
//   package.json      (+ lockfile)  the repo-root runtime package
// Runs automatically at the start of every electron build/publish script, so nothing is bumped by hand:
// change NOVA_VERSION in hud/lib/meta/version/index.ts and the next build follows it.
//
// Usage: node scripts/sync-version.mjs [--check]   (--check exits 1 instead of writing)
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const hudDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(hudDir, "..")
const versionFile = path.join(hudDir, "lib", "meta", "version", "index.ts")
const checkOnly = process.argv.includes("--check")

const match = /export const NOVA_VERSION = "V\.(\d+) Alpha"/.exec(fs.readFileSync(versionFile, "utf8"))
if (!match) {
  console.error(`[sync-version] Could not read NOVA_VERSION from ${versionFile}`)
  process.exit(1)
}
const target = `0.${Number.parseInt(match[1], 10)}.0`

// Replace only the version value(s) so the rest of each file's formatting is untouched.
// limit = how many leading `"version"` lines to rewrite: 1 for package.json; 2 for a lockfile (the top-level
// version and packages[""].version are the first two; nested dependencies come after).
function rewrite(raw, limit) {
  let replaced = 0
  return raw.replace(/^(\s*"version":\s*")([^"]*)(")/gm, (all, before, _old, after) => {
    replaced += 1
    return replaced <= limit ? `${before}${target}${after}` : all
  })
}

const files = [
  { file: path.join(hudDir, "package.json"), limit: 1 },
  { file: path.join(hudDir, "package-lock.json"), limit: 2 },
  { file: path.join(repoRoot, "package.json"), limit: 1 },
  { file: path.join(repoRoot, "package-lock.json"), limit: 2 },
]

const changes = []
for (const { file, limit } of files) {
  if (!fs.existsSync(file)) continue
  const raw = fs.readFileSync(file, "utf8")
  const next = rewrite(raw, limit)
  if (next !== raw) changes.push({ file, next })
}

if (changes.length === 0) {
  console.log(`[sync-version] All package versions are already ${target} (NOVA_VERSION V.${match[1]}).`)
  process.exit(0)
}
if (checkOnly) {
  console.error(
    `[sync-version] Out of date: ${changes.map((c) => path.relative(repoRoot, c.file)).join(", ")}. ` +
      `NOVA_VERSION V.${match[1]} requires ${target}. Run: npm run version:sync (in hud/)`,
  )
  process.exit(1)
}
for (const { file, next } of changes) fs.writeFileSync(file, next)
console.log(
  `[sync-version] Set ${target} (NOVA_VERSION V.${match[1]}) in: ${changes.map((c) => path.relative(repoRoot, c.file)).join(", ")}`,
)
