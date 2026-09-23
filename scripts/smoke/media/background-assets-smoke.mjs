/**
 * Custom background media storage (src/media/background-assets.js): chunked upload streams to disk, magic-byte
 * validation, id/path safety, Range parsing, delete, reconcile of orphans, purge. Runs on an isolated data dir.
 */
import { isolatedDataDir } from "../lib/isolated-data-dir.mjs"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"

import * as assets from "../../../src/media/background-assets.js"
import { kvGet } from "../../../src/db/index.js"

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

const USER = "local-user"
const dir = () => assets.backgroundAssetsDir(USER)
const files = () => (fs.existsSync(dir()) ? fs.readdirSync(dir()) : [])

const MP4_HEAD = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0])
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const mp4 = (size) => Buffer.concat([MP4_HEAD, Buffer.alloc(size - MP4_HEAD.length, 9)])

/** A source that yields `buffer` in small pieces, like a network body. */
function pieces(buffer, step = 1000) {
  return Readable.from(
    (function* () {
      for (let i = 0; i < buffer.length; i += step) yield buffer.subarray(i, i + step)
    })(),
  )
}

async function upload(fileName, buffer, options) {
  const begun = await assets.beginBackgroundUpload(USER, {
    fileName,
    sizeBytes: buffer.length,
    ...(options?.legacyId ? { legacyId: options.legacyId } : {}),
  })
  if ("existing" in begun) return begun.existing
  const chunk = options?.chunk ?? 5000
  for (let offset = 0; offset < buffer.length; offset += chunk) {
    await assets.appendBackgroundUploadChunk(USER, begun.uploadId, offset, pieces(buffer.subarray(offset, offset + chunk), 700))
  }
  return assets.finishBackgroundUpload(USER, begun.uploadId, options?.finish)
}

async function rejects(promise, status, code) {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof assets.BackgroundAssetError, `expected BackgroundAssetError, got ${error}`)
    assert.equal(error.status, status, `status ${error.status} ${error.message}`)
    if (code) assert.equal(error.code, code)
    return
  }
  assert.fail("expected rejection")
}

let firstId = ""
const body = mp4(23_456)

await check("storage path is under user-context/<user>/assets/background in the data dir", () => {
  const expected = path.join(isolatedDataDir, "user-context", "local-user", "assets", "background")
  assert.equal(path.resolve(dir()), path.resolve(expected))
})

await check("chunked upload streams to disk, stores metadata, becomes active", async () => {
  const meta = await upload("My Loop.mp4", body)
  firstId = meta.id
  assert.match(meta.id, /^[a-f0-9]{32}$/)
  assert.equal(meta.mimeType, "video/mp4")
  assert.equal(meta.sizeBytes, body.length)
  const onDisk = fs.readFileSync(path.join(dir(), `${meta.id}.mp4`))
  assert.ok(onDisk.equals(body), "bytes on disk differ from bytes uploaded")
  assert.equal(files().some((f) => f.startsWith(".upload-")), false, "temp files must be gone after finish")
  assert.equal(assets.getActiveBackgroundAssetId(USER), meta.id)
  const listed = await assets.listBackgroundAssets(USER)
  assert.equal(listed.activeId, meta.id)
  assert.equal(listed.assets[0].fileName, "My Loop.mp4")
})

await check("fake mp4 (exe content) is rejected on the first chunk and leaves nothing behind", async () => {
  const begun = await assets.beginBackgroundUpload(USER, { fileName: "evil.mp4", sizeBytes: 64 })
  await rejects(
    assets.appendBackgroundUploadChunk(USER, begun.uploadId, 0, pieces(Buffer.concat([Buffer.from("MZ\x90\x00", "latin1"), Buffer.alloc(60)]))),
    415,
    "content_mismatch",
  )
  assert.equal(files().filter((f) => f.startsWith(".upload-")).length, 0)
})

await check("png bytes uploaded as .mp4 and mp4 bytes uploaded as .png are rejected", async () => {
  const png = Buffer.concat([PNG_HEAD, Buffer.alloc(100)])
  await rejects(upload("x.mp4", png), 415, "content_mismatch")
  await rejects(upload("x.png", mp4(200)), 415, "content_mismatch")
})

await check("unsupported extensions are rejected (svg, exe, bmp, no extension)", async () => {
  for (const name of ["a.svg", "a.exe", "a.bmp", "a", "a.mp4.exe"]) {
    await rejects(assets.beginBackgroundUpload(USER, { fileName: name, sizeBytes: 100 }), 415, "unsupported_type")
  }
})

await check("size caps: declared size over the cap, zero, and bytes beyond the declared size", async () => {
  await rejects(assets.beginBackgroundUpload(USER, { fileName: "big.png", sizeBytes: assets.MAX_IMAGE_BYTES + 1 }), 413, "too_large")
  await rejects(assets.beginBackgroundUpload(USER, { fileName: "big.mp4", sizeBytes: assets.MAX_VIDEO_BYTES + 1 }), 413, "too_large")
  await rejects(assets.beginBackgroundUpload(USER, { fileName: "z.mp4", sizeBytes: 0 }), 400, "invalid_size")
  const begun = await assets.beginBackgroundUpload(USER, { fileName: "s.mp4", sizeBytes: 100 })
  await rejects(assets.appendBackgroundUploadChunk(USER, begun.uploadId, 0, pieces(mp4(200))), 413, "too_large")
  assert.equal(fs.statSync(path.join(dir(), `.upload-${begun.uploadId}.part`)).size, 0, "failed chunk must be truncated away")
  await assets.abortBackgroundUpload(USER, begun.uploadId)
})

await check("incomplete uploads cannot be finished; offset must match; a failed chunk can be retried", async () => {
  const data = mp4(3000)
  const begun = await assets.beginBackgroundUpload(USER, { fileName: "r.mp4", sizeBytes: data.length })
  await assets.appendBackgroundUploadChunk(USER, begun.uploadId, 0, pieces(data.subarray(0, 1000)))
  await rejects(assets.finishBackgroundUpload(USER, begun.uploadId), 409, "incomplete")
  await rejects(assets.appendBackgroundUploadChunk(USER, begun.uploadId, 500, pieces(data.subarray(500))), 409, "offset_mismatch")
  const failing = Readable.from(
    (async function* () {
      yield data.subarray(1000, 1500)
      throw new Error("connection dropped")
    })(),
  )
  await assert.rejects(assets.appendBackgroundUploadChunk(USER, begun.uploadId, 1000, failing), /connection dropped/)
  await assets.appendBackgroundUploadChunk(USER, begun.uploadId, 1000, pieces(data.subarray(1000)))
  const meta = await assets.finishBackgroundUpload(USER, begun.uploadId, { activate: false })
  assert.equal(assets.getActiveBackgroundAssetId(USER), firstId, "activate:false must not change the active asset")
  assert.ok(fs.readFileSync(path.join(dir(), `${meta.id}.mp4`)).equals(data))
  await assets.deleteBackgroundAsset(USER, meta.id)
})

await check("hostile ids never reach the filesystem", async () => {
  const bad = [
    "../x",
    "..\\x",
    "a/b",
    "C:\\Windows\\win.ini",
    "\\\\server\\share\\f",
    "NUL",
    "con.mp4",
    "abc",
    "",
    null,
    undefined,
    42,
    `${"a".repeat(31)}\u0000`,
    "A".repeat(32),
    `${"a".repeat(32)}.mp4`,
    `${"a".repeat(31)}/`,
  ]
  for (const id of bad) {
    assert.equal(assets.parseAssetId(id), null, `parseAssetId accepted ${JSON.stringify(id)}`)
    assert.equal(await assets.statBackgroundAsset(USER, id), null)
    assert.equal(await assets.deleteBackgroundAsset(USER, id), false)
    assert.equal(assets.parseUploadId(id), null)
  }
  assert.throws(() => assets.setActiveBackgroundAsset(USER, "../../nova.db"), assets.BackgroundAssetError)
  await rejects(assets.appendBackgroundUploadChunk(USER, "../../x", 0, pieces(Buffer.alloc(4))), 404)
  await rejects(assets.beginBackgroundUpload(USER, { fileName: "a.png", sizeBytes: 10, legacyId: "../x" }), 400, "invalid_legacy_id")
  // a user id cannot escape user-context either
  const evilDir = assets.backgroundAssetsDir("../../evil")
  assert.ok(path.resolve(evilDir).startsWith(path.resolve(isolatedDataDir, "user-context") + path.sep))
  assert.equal(assets.sanitizeDisplayName("..\\..\\evil\u0000.mp4"), "evil.mp4")
})

await check("Range parsing", () => {
  const p = assets.parseRangeHeader
  assert.deepEqual(p(null, 1000), { kind: "none" })
  assert.deepEqual(p("bytes=0-99", 1000), { kind: "range", start: 0, end: 99 })
  assert.deepEqual(p("bytes=900-", 1000), { kind: "range", start: 900, end: 999 })
  assert.deepEqual(p("bytes=-100", 1000), { kind: "range", start: 900, end: 999 })
  assert.deepEqual(p("bytes=-5000", 1000), { kind: "range", start: 0, end: 999 })
  assert.deepEqual(p("bytes=990-5000", 1000), { kind: "range", start: 990, end: 999 })
  assert.deepEqual(p("bytes=1000-", 1000), { kind: "unsatisfiable" })
  assert.deepEqual(p("bytes=-0", 1000), { kind: "unsatisfiable" })
  assert.deepEqual(p("bytes=5-2", 1000), { kind: "none" })
  assert.deepEqual(p("bytes=0-1,5-9", 1000), { kind: "none" })
  assert.deepEqual(p("items=0-1", 1000), { kind: "none" })
  assert.deepEqual(p("garbage", 1000), { kind: "none" })
})

await check("stat + read stream returns the exact Range slice", async () => {
  const stat = await assets.statBackgroundAsset(USER, firstId)
  assert.ok(stat)
  assert.equal(stat.size, body.length)
  assert.equal(stat.mimeType, "video/mp4")
  const range = assets.parseRangeHeader("bytes=100-1099", stat.size)
  assert.equal(range.kind, "range")
  const chunks = []
  for await (const chunk of assets.openBackgroundAssetStream(stat.filePath, range.start, range.end)) chunks.push(chunk)
  const slice = Buffer.concat(chunks)
  assert.equal(slice.length, range.end - range.start + 1)
  assert.ok(slice.equals(body.subarray(100, 1100)))
})

await check("legacyId import is idempotent and the asset cap is enforced", async () => {
  const png = Buffer.concat([PNG_HEAD, Buffer.alloc(300, 1)])
  const a = await upload("legacy.png", png, { legacyId: "1712345_abcd1234", finish: { activate: false } })
  const b = await upload("legacy.png", png, { legacyId: "1712345_abcd1234", finish: { activate: false } })
  assert.equal(a.id, b.id, "same legacyId must not create a second asset")
  assert.equal((await assets.listBackgroundAssets(USER)).assets.length, 2)
  for (let i = 0; i < assets.MAX_ASSETS_PER_USER - 2; i += 1) await upload(`p${i}.png`, png, { finish: { activate: false } })
  await rejects(assets.beginBackgroundUpload(USER, { fileName: "one-too-many.png", sizeBytes: 10 }), 409, "too_many_assets")
  for (const item of (await assets.listBackgroundAssets(USER)).assets) {
    if (item.id !== firstId) await assets.deleteBackgroundAsset(USER, item.id)
  }
})

await check("delete removes the file and row; deleting the active asset clears active", async () => {
  const meta = await upload("gone.png", Buffer.concat([PNG_HEAD, Buffer.alloc(50)]))
  assert.equal(assets.getActiveBackgroundAssetId(USER), meta.id)
  assert.equal(await assets.deleteBackgroundAsset(USER, meta.id), true)
  assert.equal(fs.existsSync(path.join(dir(), `${meta.id}.png`)), false)
  assert.equal(assets.getActiveBackgroundAssetId(USER), null)
  assert.equal(kvGet(USER, assets.BACKGROUND_KV_NAMESPACE, `asset:${meta.id}`), null)
  assert.equal(await assets.statBackgroundAsset(USER, meta.id), null)
  assert.equal(await assets.deleteBackgroundAsset(USER, meta.id), false)
  assets.setActiveBackgroundAsset(USER, firstId)
  assert.equal(assets.getActiveBackgroundAssetId(USER), firstId)
  assets.setActiveBackgroundAsset(USER, null)
  assert.equal(assets.getActiveBackgroundAssetId(USER), null)
})

await check("reconcile removes orphan files, drops rows without files, sweeps stale temp files", async () => {
  const old = new Date(Date.now() - 2 * assets.STALE_UPLOAD_MS)
  const orphan = path.join(dir(), `${"b".repeat(32)}.mp4`)
  fs.writeFileSync(orphan, "orphan")
  fs.utimesSync(orphan, old, old)
  const stale = path.join(dir(), `.upload-${"c".repeat(32)}.part`)
  fs.writeFileSync(stale, "x")
  fs.utimesSync(stale, old, old)
  fs.writeFileSync(path.join(dir(), "notes.txt"), "not ours")
  fs.rmSync(path.join(dir(), `${firstId}.mp4`))
  const listed = await assets.listBackgroundAssets(USER)
  assert.equal(listed.assets.length, 0, "row whose file vanished must be dropped")
  assert.deepEqual(files(), [])
})

await check("purge removes every file and row for the user, other users untouched", async () => {
  const other = "someone-else"
  const png = Buffer.concat([PNG_HEAD, Buffer.alloc(80)])
  const mine = await upload("a.png", png)
  const begun = await assets.beginBackgroundUpload(other, { fileName: "o.png", sizeBytes: png.length })
  await assets.appendBackgroundUploadChunk(other, begun.uploadId, 0, pieces(png))
  const theirs = await assets.finishBackgroundUpload(other, begun.uploadId)
  await assets.beginBackgroundUpload(USER, { fileName: "pending.png", sizeBytes: 10 })
  await assets.purgeBackgroundAssets(USER)
  assert.equal(fs.existsSync(dir()), false, "asset directory must be gone")
  assert.equal((await assets.listBackgroundAssets(USER)).assets.length, 0)
  assert.equal(kvGet(USER, assets.BACKGROUND_KV_NAMESPACE, `asset:${mine.id}`), null)
  assert.equal(assets.getActiveBackgroundAssetId(USER), null)
  assert.ok(await assets.statBackgroundAsset(other, theirs.id), "another user's asset must survive")
  await assets.purgeBackgroundAssets(other)
  assert.equal(await assets.statBackgroundAsset(other, theirs.id), null)
})

console.log(`\n${passed} checks passed`)
