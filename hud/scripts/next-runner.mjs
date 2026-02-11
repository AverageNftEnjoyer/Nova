import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const here = dirname(fileURLToPath(import.meta.url))
const nextBin = resolve(here, "../node_modules/next/dist/bin/next")

const child = spawn(process.execPath, [nextBin, ...args], {
  stdio: ["inherit", "pipe", "pipe"],
  shell: false,
  env: {
    ...process.env,
    BROWSERSLIST_IGNORE_OLD_DATA: "true",
    BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: "true",
  },
})

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

child.on("close", (code) => {
  process.exit(code ?? 1)
})
