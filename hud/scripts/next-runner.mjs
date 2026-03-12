import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync, readFileSync } from "node:fs"

const args = process.argv.slice(2)
const isDev = args[0] === "dev"
const hasBundlerFlag = args.includes("--webpack") || args.includes("--turbo") || args.includes("--turbopack")
const preferWebpack = process.env.NOVA_USE_TURBOPACK !== "1"
const nextArgs = isDev && !hasBundlerFlag && preferWebpack ? [...args, "--webpack"] : args
const here = dirname(fileURLToPath(import.meta.url))
const nextBin = resolve(here, "../node_modules/next/dist/bin/next")
const rootEnvPath = resolve(here, "../../.env")

function parseEnvFile(raw) {
  const out = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx < 0) continue
    const key = trimmed.slice(0, idx).trim()
    if (!key) continue
    let value = trimmed.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function failSpawn(stage, err) {
  const details = err && typeof err === "object"
    ? {
        code: String(err.code || "").trim(),
        message: String(err.message || "").trim(),
      }
    : {
        code: "",
        message: String(err || "unknown error").trim(),
      }
  const codeSuffix = details.code ? ` code=${details.code}` : ""
  const message = details.message || "unknown error"
  process.stderr.write(`[next-runner] failed to ${stage} Next process${codeSuffix}: ${message}\n`)
  process.exit(1)
}

const rootEnv = existsSync(rootEnvPath) ? parseEnvFile(readFileSync(rootEnvPath, "utf8")) : {}

let child = null
try {
  child = spawn(process.execPath, [nextBin, ...nextArgs], {
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
    env: {
      ...rootEnv,
      ...process.env,
      BROWSERSLIST_IGNORE_OLD_DATA: "true",
      BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: "true",
    },
  })
} catch (err) {
  failSpawn("spawn", err)
}

const shouldDrop = (line) => line.includes("[baseline-browser-mapping]")

const pipeFiltered = (stream, target) => {
  let buffer = ""
  stream.on("data", (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!shouldDrop(line)) {
        target.write(line + "\n")
      }
    }
  })
  stream.on("end", () => {
    if (buffer && !shouldDrop(buffer)) {
      target.write(buffer + "\n")
    }
  })
}

pipeFiltered(child.stdout, process.stdout)
pipeFiltered(child.stderr, process.stderr)

child.on("error", (err) => {
  failSpawn("run", err)
})

child.on("close", (code) => {
  process.exit(code ?? 1)
})
