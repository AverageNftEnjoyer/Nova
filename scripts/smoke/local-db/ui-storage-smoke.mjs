/**
 * Settings mirror (hud/lib/settings/ui-storage): server store validation + per-user isolation, the size-capped
 * body reader used by the route, the pure hydrate merge, and the browser client (durable pending queue) driven
 * against a fake localStorage/fetch wired to the real store. Also proves account deletion removes the user's
 * ui-storage rows and background assets. Runs on an isolated data dir; the hud TS is transpiled to a temp dir.
 */
import "../lib/isolated-data-dir.mjs" // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

import * as assets from "../../../src/media/background-assets.js"
import { kvGet, kvList, purgeLocalUserData } from "../../../src/db/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-ui-storage-"))
process.on("exit", () => fs.rmSync(tempRoot, { recursive: true, force: true }))

const dbModulePath = path.join(repoRoot, "src", "db", "index.js").replace(/\\/g, "/")
const dir = "hud/lib/settings/ui-storage"
for (const file of ["keys", "merge", "store", "client", "request-body"]) {
  const source = fs.readFileSync(path.join(repoRoot, dir, `${file}.ts`), "utf8")
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  fs.mkdirSync(path.join(tempRoot, dir), { recursive: true })
  fs.writeFileSync(
    path.join(tempRoot, dir, `${file}.js`),
    out.outputText.split("../../../../src/db/index.js").join(dbModulePath),
    "utf8",
  )
}
const require = createRequire(path.join(tempRoot, "loader.cjs"))
const load = (file) => require(`./${dir}/${file}.js`)
const keys = load("keys")
const store = load("store")
const merge = load("merge")
const body = load("request-body")

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}\n  ${error?.stack || error}`)
    process.exitCode = 1
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const A = "user-a"
const B = "user-b"
const K1 = "nova_user_settings:v1:user-a"
const K2 = "nova_home_crypto_range"

// ---------------------------------------------------------------- store
await check("allowlist: non-synced keys are rejected and nothing is written", () => {
  assert.throws(() => store.writeUiStorage(A, { [K1]: "ok", theme_secret: "x" }), store.UiStorageValidationError)
  assert.throws(() => store.writeUiStorage(A, { "": "x" }), store.UiStorageValidationError)
  assert.deepEqual(store.listUiStorage(A), {}, "validation is all-or-nothing")
  assert.equal(keys.isSyncedKey(merge.PENDING_QUEUE_STORAGE_KEY), false, "the pending queue must not be synced itself")
})

await check("value type and size caps", () => {
  assert.throws(() => store.writeUiStorage(A, { [K1]: 5 }), store.UiStorageValidationError)
  assert.throws(() => store.writeUiStorage(A, { [K1]: "x".repeat(keys.MAX_SYNCED_VALUE_CHARS + 1) }), store.UiStorageValidationError)
  store.writeUiStorage(A, { [K1]: "x".repeat(keys.MAX_SYNCED_VALUE_CHARS) })
  store.writeUiStorage(A, { [K1]: null })
  const many = Object.fromEntries(Array.from({ length: keys.MAX_ITEMS_PER_REQUEST + 1 }, (_, i) => [`nova_home_${i}`, "v"]))
  assert.throws(() => store.writeUiStorage(A, many), store.UiStorageValidationError)
  assert.throws(() => store.writeUiStorage("  ", { [K1]: "x" }), store.UiStorageValidationError)
})

await check("batch write/delete/list with timestamps", () => {
  assert.deepEqual(store.writeUiStorage(A, { [K1]: "one", [K2]: "7d" }), { written: 2, deleted: 0 })
  const listed = store.listUiStorage(A)
  assert.deepEqual(Object.keys(listed).sort(), [K2, K1].sort())
  assert.equal(listed[K1].value, "one")
  assert.ok(Number.isFinite(Date.parse(listed[K1].updatedAt)))
  assert.deepEqual(store.writeUiStorage(A, { [K1]: "two", [K2]: null }), { written: 1, deleted: 1 })
  assert.equal(store.listUiStorage(A)[K1].value, "two")
  assert.equal(K2 in store.listUiStorage(A), false)
})

await check("per-user isolation", () => {
  store.writeUiStorage(B, { [K1]: "b-value" })
  assert.equal(store.listUiStorage(A)[K1].value, "two")
  assert.equal(store.listUiStorage(B)[K1].value, "b-value")
  store.writeUiStorage(B, { [K1]: null })
  assert.equal(store.listUiStorage(A)[K1].value, "two")
})

// ---------------------------------------------------------------- body reader
await check("body reader: content-length cap, streaming cap without header, invalid JSON", async () => {
  const mk = (text, headers) => new Request("http://localhost/x", { method: "PUT", body: text, headers })
  assert.deepEqual(await body.readJsonBodyLimited(mk('{"a":1}'), 100), { a: 1 })
  await assert.rejects(body.readJsonBodyLimited(mk('{"a":"' + "x".repeat(500) + '"}'), 100), body.BodyTooLargeError)
  // Declared length over the cap is refused before the body is read.
  const lying = mk('{"a":1}', { "content-length": "999999" })
  await assert.rejects(body.readJsonBodyLimited(lying, 100), body.BodyTooLargeError)
  // A stream with no content-length is still capped while reading.
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < 10; i += 1) controller.enqueue(new TextEncoder().encode("x".repeat(50)))
      controller.close()
    },
  })
  const streamed = new Request("http://localhost/x", { method: "PUT", body: stream, duplex: "half" })
  await assert.rejects(body.readJsonBodyLimited(streamed, 200), body.BodyTooLargeError)
  await assert.rejects(body.readJsonBodyLimited(mk("not json"), 100), body.BodyParseError)
  assert.ok(body.MAX_UI_STORAGE_BODY_BYTES > keys.MAX_SYNCED_VALUE_CHARS)
})

// ---------------------------------------------------------------- pure merge
const iso = (ms) => new Date(ms).toISOString()
await check("merge: pending local edit newer than server wins and is pushed", () => {
  const plan = merge.planHydration(
    { [K1]: { value: "server", updatedAt: iso(1000) } },
    { [K1]: { deleted: false, updatedAt: 2000 } },
    { [K1]: "local" },
  )
  assert.deepEqual(plan.push, { [K1]: "local" })
  assert.deepEqual(plan.applyServer, {})
})

await check("merge: pending delete newer than server is not resurrected", () => {
  const plan = merge.planHydration(
    { [K1]: { value: "server", updatedAt: iso(1000) } },
    { [K1]: { deleted: true, updatedAt: 2000 } },
    {},
  )
  assert.deepEqual(plan.push, { [K1]: null })
  assert.deepEqual(plan.removeLocal, [K1])
  assert.deepEqual(plan.applyServer, {})
})

await check("merge: server wins with no pending edit, or when the edit is older", () => {
  const noEdit = merge.planHydration({ [K1]: { value: "server", updatedAt: iso(1000) } }, {}, { [K1]: "stale" })
  assert.deepEqual(noEdit.applyServer, { [K1]: "server" })
  assert.deepEqual(noEdit.push, {})
  const older = merge.planHydration(
    { [K1]: { value: "server", updatedAt: iso(5000) } },
    { [K1]: { deleted: false, updatedAt: 2000 } },
    { [K1]: "local" },
  )
  assert.deepEqual(older.applyServer, { [K1]: "server" })
  assert.deepEqual(older.dropPending, [K1])
})

await check("merge: local-only keys upload; pending delete of an absent key is dropped; queue parsing is defensive", () => {
  const plan = merge.planHydration({}, { [K2]: { deleted: true, updatedAt: 5 } }, { [K1]: "legacy" })
  assert.deepEqual(plan.push, { [K1]: "legacy" })
  assert.deepEqual(plan.dropPending, [K2])
  assert.deepEqual(merge.parsePendingQueue("{oops"), {})
  assert.deepEqual(merge.parsePendingQueue('{"k":{"deleted":"no","updatedAt":1}}'), {})
  assert.deepEqual(merge.parsePendingQueue(merge.serializePendingQueue({ k: { deleted: true, updatedAt: 9 } })), {
    k: { deleted: true, updatedAt: 9 },
  })
})

// ---------------------------------------------------------------- client end to end
class FakeStorage {
  constructor() {
    this.map = new Map()
  }
  get length() {
    return this.map.size
  }
  key(i) {
    return [...this.map.keys()][i] ?? null
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null
  }
  setItem(k, v) {
    this.map.set(k, String(v))
  }
  removeItem(k) {
    this.map.delete(k)
  }
}
const CLIENT = "client-user"
const ck = `nova_user_settings:v1:${CLIENT}`
let online = true
const puts = []
globalThis.window = { addEventListener() {} }
globalThis.document = { addEventListener() {}, visibilityState: "visible" }
globalThis.localStorage = new FakeStorage()
globalThis.fetch = async (_url, init) => {
  if (!online) throw new TypeError("offline")
  if (init?.method === "PUT") {
    const { items } = JSON.parse(init.body)
    puts.push(items)
    const result = store.writeUiStorage(CLIENT, items)
    return { ok: true, json: async () => ({ ok: true, ...result }) }
  }
  return { ok: true, json: async () => ({ ok: true, items: store.listUiStorage(CLIENT) }) }
}

/** A "restart": fresh module state (in-memory queue gone), same localStorage. */
function freshClient() {
  const file = require.resolve(`./${dir}/client.js`)
  delete require.cache[file]
  return load("client")
}
const serverValue = (key) => store.listUiStorage(CLIENT)[key]?.value ?? null

await check("client: offline edit survives a restart and beats the older server copy", async () => {
  store.writeUiStorage(CLIENT, { [ck]: "old" })
  await sleep(15)
  online = false
  let c = freshClient()
  localStorage.setItem(ck, "new")
  c.persistUiStorageKey(ck, "new")
  await c.flushUiStorage() // fails: stays queued
  assert.equal(serverValue(ck), "old")
  assert.ok(localStorage.getItem(merge.PENDING_QUEUE_STORAGE_KEY), "queue is durable")
  online = true
  c = freshClient()
  await c.hydrateUiStorage()
  await c.flushUiStorage()
  assert.equal(localStorage.getItem(ck), "new", "local edit must not be reverted")
  assert.equal(serverValue(ck), "new")
  assert.equal(localStorage.getItem(merge.PENDING_QUEUE_STORAGE_KEY), null, "queue drained after ack")
})

await check("client: offline delete is not resurrected and reaches the server", async () => {
  await sleep(15)
  online = false
  let c = freshClient()
  localStorage.removeItem(ck)
  c.persistUiStorageKey(ck, null)
  await c.flushUiStorage()
  assert.equal(serverValue(ck), "new")
  online = true
  c = freshClient()
  await c.hydrateUiStorage()
  await c.flushUiStorage()
  assert.equal(localStorage.getItem(ck), null)
  assert.equal(serverValue(ck), null)
})

await check("client: server wins when there is no pending edit; older pending edit loses", async () => {
  store.writeUiStorage(CLIENT, { [ck]: "from-server" })
  localStorage.setItem(ck, "stale-cache")
  let c = freshClient()
  await c.hydrateUiStorage()
  assert.equal(localStorage.getItem(ck), "from-server")
  // A pending edit that predates the server copy loses.
  localStorage.setItem(ck, "ancient-local")
  localStorage.setItem(merge.PENDING_QUEUE_STORAGE_KEY, merge.serializePendingQueue({ [ck]: { deleted: false, updatedAt: 1000 } }))
  c = freshClient()
  await c.hydrateUiStorage()
  assert.equal(localStorage.getItem(ck), "from-server")
  assert.equal(localStorage.getItem(merge.PENDING_QUEUE_STORAGE_KEY), null)
})

await check("client: hydrate never rejects when the server is unreachable, and legacy local keys upload", async () => {
  const c = freshClient()
  online = false
  await c.hydrateUiStorage(200)
  online = true
  const legacy = `nova_home_legacy_${CLIENT}`
  localStorage.setItem(legacy, "only-local")
  await c.hydrateUiStorage()
  await c.flushUiStorage()
  assert.equal(serverValue(legacy), "only-local")
})

await check("client: non-synced keys are never queued or sent", async () => {
  const before = puts.length
  const c = freshClient()
  c.persistUiStorageKey("some_cache_key", "x")
  await c.flushUiStorage()
  assert.equal(puts.length, before)
  assert.equal(localStorage.getItem(merge.PENDING_QUEUE_STORAGE_KEY), null)
})

// ---------------------------------------------------------------- account delete
await check("account delete: purge removes ui-storage rows and background assets; route wires both", async () => {
  const user = "delete-me"
  store.writeUiStorage(user, { [`nova_user_settings:v1:${user}`]: "profile" })
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])
  const begun = await assets.beginBackgroundUpload(user, { fileName: "bg.png", sizeBytes: png.length })
  const { Readable } = await import("node:stream")
  await assets.appendBackgroundUploadChunk(user, begun.uploadId, 0, Readable.from([png]))
  await assets.finishBackgroundUpload(user, begun.uploadId)
  assert.ok(fs.existsSync(assets.backgroundAssetsDir(user)))
  store.writeUiStorage(A, { [K1]: "keep" })

  purgeLocalUserData(user)
  await assets.purgeBackgroundAssets(user)

  assert.deepEqual(store.listUiStorage(user), {})
  assert.equal(kvList(user, keys.UI_STORAGE_NAMESPACE).length, 0)
  assert.equal(fs.existsSync(assets.backgroundAssetsDir(user)), false)
  assert.equal(kvGet(user, assets.BACKGROUND_KV_NAMESPACE, "active"), null)
  assert.equal(store.listUiStorage(A)[K1].value, "keep", "other users are untouched")

  const route = fs.readFileSync(path.join(repoRoot, "hud/app/api/account/delete/route.ts"), "utf8")
  assert.match(route, /purgeLocalUserData\(/)
  assert.match(route, /purgeBackgroundAssets\(/)
})

console.log(`\n${passed} checks passed`)
