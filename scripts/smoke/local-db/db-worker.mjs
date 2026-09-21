/**
 * Child-process worker for the local-db smokes. Not a smoke itself.
 * argv: <mode> <arg-json>
 * A `go` file acts as a start barrier so the workers really contend.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dbEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "db", "index.js")
const db = await import(new URL(`file:///${dbEntry.replace(/\\/g, "/")}`).href)

const mode = process.argv[2]
const args = JSON.parse(process.argv[3] || "{}")

async function waitForGo() {
  if (!args.goFile) return
  const deadline = Date.now() + 15_000
  while (!fs.existsSync(args.goFile)) {
    if (Date.now() > deadline) throw new Error("barrier timeout")
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

async function main() {
  await waitForGo()

  if (mode === "migrate") {
    const conn = db.openDbAt(args.file)
    const version = conn.pragma("user_version", { simple: true })
    conn.close()
    console.log(JSON.stringify({ version }))
    return
  }

  if (mode === "insert") {
    const conn = db.openDbAt(args.file, { skipMigrations: true })
    for (let n = 0; n < args.count; n += 1) {
      db.txOn(
        conn,
        () => {
          conn.prepare("INSERT INTO smoke_rows (worker, n) VALUES (?, ?)").run(args.worker, n)
        },
        "immediate",
      )
    }
    conn.close()
    return
  }

  if (mode === "mixed") {
    // Uses the singleton (NOVA_DATA_DIR is set in the child's env) exactly like app code would.
    const userId = `user-${args.worker % 2}`
    for (let n = 0; n < args.count; n += 1) {
      db.kvSet(userId, "mixed", `w${args.worker}-${n}`, { worker: args.worker, n })
      db.tx((conn) => {
        conn.prepare("INSERT INTO smoke_rows (worker, n) VALUES (?, ?)").run(args.worker, n)
        conn.prepare("UPDATE smoke_counter SET total = total + 1 WHERE id = 1").run()
      })
      if (n % 5 === 0) {
        db.tx((conn) => conn.prepare("SELECT COUNT(*) AS c FROM smoke_rows").get(), "deferred")
        db.kvList(userId, "mixed")
      }
      if (n % 25 === 0) db.kvDelete(userId, "mixed", `w${args.worker}-${Math.max(0, n - 1)}`)
    }
    db.closeDb()
    return
  }

  throw new Error(`unknown mode ${mode}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  process.exit(1)
})
