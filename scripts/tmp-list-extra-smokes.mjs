import fs from "node:fs"
import path from "node:path"

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
const scripts = pkg.scripts
const roots = [
  "smoke:fundamental",
  "smoke:src-release",
  "smoke:version-sync",
  "smoke:production-boot",
  "smoke:production-routes",
  "guard:hud-integrations-secrets",
  "smoke:token-deep",
  "smoke:token-gate",
]
const seen = new Set()
const files = new Set()

function walk(name) {
  if (seen.has(name)) return
  seen.add(name)
  const cmd = scripts[name]
  if (!cmd) {
    console.log("MISSING SCRIPT", name)
    return
  }
  for (const match of cmd.matchAll(/npm run ([\w:-]+)/g)) walk(match[1])
  for (const match of cmd.matchAll(/node (?:--experimental-strip-types )?(\S+\.mjs)/g)) {
    files.add(match[1].replaceAll("\\", "/"))
  }
}

for (const root of roots) walk(root)

const all = []
function walkDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = path.join(dir, entry.name).replaceAll("\\", "/")
    if (entry.isDirectory()) walkDir(next)
    else if (/\.(mjs|ps1)$/.test(entry.name)) all.push(next)
  }
}
walkDir("scripts/smoke")
walkDir("scripts/coinbase/smoke")

const keepPrefixes = ["/lib/", "token-harness", "token-baseline", "token-gate-break", "verify-release", "fixtures"]
const drop = all.filter((file) => !files.has(file) && !keepPrefixes.some((part) => file.includes(part)))
console.log(`KEEP ${files.size}`)
console.log([...files].sort().join("\n"))
console.log("---DROP---")
console.log(`DROP ${drop.length}`)
console.log(drop.join("\n"))
