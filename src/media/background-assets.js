/**
 * Custom background media (video/image) stored in the data directory.
 *
 * Files live at `<userContextRoot>/<userId>/assets/background/<assetId>.<ext>`, so they move with nova.db under
 * NOVA_DATA_DIR / %APPDATA%\Nova, are covered by backup/restore and are removed together with the user's
 * `user-context/<userId>/` folder on account delete. Metadata and the active asset id are kept in nova.db
 * (kv_state, namespace "background-assets").
 *
 * Security model
 * - The server generates every asset id (32 hex chars); ids from callers are validated against that exact shape and
 *   are the only thing ever joined into a path. Client file names are display text only, never a path component.
 * - Allowed types: png, jpg/jpeg, webp, gif, mp4. The extension AND the leading magic bytes must agree.
 *   SVG is rejected on purpose: it can carry script and would run in the app's origin if opened directly.
 * - Uploads are chunked (begin -> append* -> finish): every chunk is streamed to a `.part` temp file and the finished
 *   file is renamed atomically. Chunking also keeps each request below Next's proxy body-clone limit (10 MB) and
 *   makes a retry after a dropped connection safe (a failed chunk is truncated away).
 */
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"

import { kvDelete, kvGet, kvList, kvSet } from "../db/index.js"
import { resolveUserContextRoot } from "../db/paths.js"

export const BACKGROUND_KV_NAMESPACE = "background-assets"
export const ACTIVE_KEY = "active"
export const ASSET_KEY_PREFIX = "asset:"

export const MAX_VIDEO_BYTES = 512 * 1024 * 1024
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024
/** Largest single chunk body accepted by appendUploadChunk (client uses this size). */
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024
export const MAX_ASSETS_PER_USER = 10
/** Unfinished upload sessions and stray temp files older than this are swept. */
export const STALE_UPLOAD_MS = 60 * 60 * 1000
/** An orphaned final file is only deleted once it is this old (a just-renamed upload may not have its row yet). */
const ORPHAN_GRACE_MS = 60 * 1000

const ASSET_ID_PATTERN = /^[a-f0-9]{32}$/
const UPLOAD_ID_PATTERN = /^[a-f0-9]{32}$/
const LEGACY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const FINAL_FILE_PATTERN = /^([a-f0-9]{32})\.(png|jpg|jpeg|webp|gif|mp4)$/
const SESSION_FILE_PATTERN = /^\.upload-([a-f0-9]{32})\.(part|json)$/

/** extension -> { mimeType, kind } */
const TYPES = {
  png: { mimeType: "image/png", kind: "image" },
  jpg: { mimeType: "image/jpeg", kind: "image" },
  jpeg: { mimeType: "image/jpeg", kind: "image" },
  webp: { mimeType: "image/webp", kind: "image" },
  gif: { mimeType: "image/gif", kind: "image" },
  mp4: { mimeType: "video/mp4", kind: "video" },
}

export class BackgroundAssetError extends Error {
  /** @param {string} message @param {number} status @param {string} code */
  constructor(message, status, code) {
    super(message)
    this.name = "BackgroundAssetError"
    this.status = status
    this.code = code
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (exercised directly by the smoke test)
// ---------------------------------------------------------------------------------------------------------------

/** Returns the id when it has the exact server-generated shape, otherwise null. */
export function parseAssetId(value) {
  return typeof value === "string" && ASSET_ID_PATTERN.test(value) ? value : null
}

export function parseUploadId(value) {
  return typeof value === "string" && UPLOAD_ID_PATTERN.test(value) ? value : null
}

/** Lower-cased allowed extension of a client file name, or null. */
export function extensionOf(fileName) {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(String(fileName ?? "").trim())
  const ext = match ? match[1].toLowerCase() : ""
  return Object.hasOwn(TYPES, ext) ? ext : null
}

export function mimeTypeForExtension(ext) {
  return Object.hasOwn(TYPES, ext) ? TYPES[ext].mimeType : null
}

export function maxBytesForExtension(ext) {
  if (!Object.hasOwn(TYPES, ext)) return 0
  return TYPES[ext].kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
}

/** Display-only name: no path parts, no control characters, bounded. */
export function sanitizeDisplayName(fileName) {
  const base = String(fileName ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split(/[\\/]/)
    .pop()
    .trim()
    .slice(0, 180)
  return base || "Background"
}

/**
 * Checks the leading bytes against the type the extension claims.
 * Returns true/false, or null when there are not yet enough bytes to decide.
 */
export function matchesMagicBytes(ext, head) {
  if (!Object.hasOwn(TYPES, ext)) return false
  const b = head
  const startsWith = (sig, offset = 0) => sig.every((v, i) => b[offset + i] === v)
  switch (ext) {
    case "png":
      return b.length < 8 ? null : startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case "jpg":
    case "jpeg":
      return b.length < 3 ? null : startsWith([0xff, 0xd8, 0xff])
    case "gif":
      return b.length < 6 ? null : startsWith([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    case "webp":
      return b.length < 12 ? null : startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)
    case "mp4":
      return b.length < 12 ? null : startsWith([0x66, 0x74, 0x79, 0x70], 4)
    default:
      return false
  }
}

/**
 * Parse an HTTP Range header for a resource of `size` bytes.
 *  - { kind: "none" }: no/ignorable header (absent, malformed, multi-range or non-bytes unit): serve the whole file.
 *  - { kind: "range", start, end }: inclusive byte offsets, `end` clamped to size-1.
 *  - { kind: "unsatisfiable" }: answer 416 with `Content-Range: bytes * /size`.
 */
export function parseRangeHeader(header, size) {
  if (header === null || header === undefined || header === "") return { kind: "none" }
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(String(header))
  if (!match) return { kind: "none" }
  const [, rawStart, rawEnd] = match
  if (rawStart === "" && rawEnd === "") return { kind: "none" }
  if (size <= 0) return { kind: "unsatisfiable" }
  if (rawStart === "") {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: "unsatisfiable" }
    return { kind: "range", start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isSafeInteger(start) || start >= size) return { kind: "unsatisfiable" }
  if (rawEnd === "") return { kind: "range", start, end: size - 1 }
  const end = Number(rawEnd)
  if (!Number.isSafeInteger(end) || end < start) return { kind: "none" }
  return { kind: "range", start, end: Math.min(end, size - 1) }
}

/** Folder-safe form of a user id (same rules the account-delete route uses for `user-context/<id>`). */
export function normalizeUserSegment(userId) {
  return String(userId ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

// ---------------------------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------------------------

function requireUser(userId) {
  const uid = String(userId ?? "").trim()
  const segment = normalizeUserSegment(uid)
  if (!uid || !segment) throw new BackgroundAssetError("A user is required.", 400, "invalid_user")
  return { uid, segment }
}

/** `<userContextRoot>/<userId>/assets/background` (not created). */
export function backgroundAssetsDir(userId) {
  const { segment } = requireUser(userId)
  const root = path.resolve(resolveUserContextRoot())
  const dir = path.resolve(root, segment, "assets", "background")
  const rel = path.relative(root, dir)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new BackgroundAssetError("Invalid asset location.", 400, "invalid_path")
  }
  return dir
}

function assetFilePath(userId, assetId, ext) {
  return path.join(backgroundAssetsDir(userId), `${assetId}.${ext}`)
}

function sessionPaths(userId, uploadId) {
  const dir = backgroundAssetsDir(userId)
  return { dir, part: path.join(dir, `.upload-${uploadId}.part`), meta: path.join(dir, `.upload-${uploadId}.json`) }
}

function kvKeyFor(assetId) {
  return `${ASSET_KEY_PREFIX}${assetId}`
}

function toPublicMeta(record) {
  return {
    id: record.id,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt,
  }
}

function readRecord(uid, assetId) {
  const value = kvGet(uid, BACKGROUND_KV_NAMESPACE, kvKeyFor(assetId))
  if (!value || typeof value !== "object") return null
  const record = value
  if (record.id !== assetId || !Object.hasOwn(TYPES, record.ext)) return null
  return record
}

// ---------------------------------------------------------------------------------------------------------------
// Upload sessions
// ---------------------------------------------------------------------------------------------------------------

/** Serialises operations per upload session so concurrent chunks cannot interleave. */
const sessionLocks = new Map()
async function withSessionLock(uploadId, fn) {
  const previous = sessionLocks.get(uploadId) ?? Promise.resolve()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const chained = previous.then(() => gate)
  sessionLocks.set(uploadId, chained)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (sessionLocks.get(uploadId) === chained) sessionLocks.delete(uploadId)
  }
}

async function readSession(userId, uploadId) {
  const id = parseUploadId(uploadId)
  if (!id) throw new BackgroundAssetError("Unknown upload.", 404, "upload_not_found")
  const paths = sessionPaths(userId, id)
  let parsed
  try {
    parsed = JSON.parse(await fsp.readFile(paths.meta, "utf8"))
  } catch {
    throw new BackgroundAssetError("Unknown upload.", 404, "upload_not_found")
  }
  if (!parsed || !Object.hasOwn(TYPES, parsed.ext) || !Number.isSafeInteger(parsed.declaredSize)) {
    throw new BackgroundAssetError("Unknown upload.", 404, "upload_not_found")
  }
  return { id, paths, session: parsed }
}

async function discardSession(paths) {
  await Promise.all([fsp.rm(paths.part, { force: true }).catch(() => {}), fsp.rm(paths.meta, { force: true }).catch(() => {})])
}

/**
 * Start an upload. Returns `{ uploadId, chunkBytes }`, or `{ existing }` when `legacyId` was already imported
 * (makes the one-time IndexedDB migration idempotent).
 */
export async function beginBackgroundUpload(userId, input) {
  const { uid } = requireUser(userId)
  const ext = extensionOf(input?.fileName)
  if (!ext) {
    throw new BackgroundAssetError("Only MP4, PNG, JPG, WEBP or GIF files are supported.", 415, "unsupported_type")
  }
  const declaredSize = input?.sizeBytes
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) {
    throw new BackgroundAssetError("A file size is required.", 400, "invalid_size")
  }
  const cap = maxBytesForExtension(ext)
  if (declaredSize > cap) {
    throw new BackgroundAssetError(
      `File is too large. Max size is ${Math.round(cap / (1024 * 1024))}MB for ${TYPES[ext].kind}s.`,
      413,
      "too_large",
    )
  }
  let legacyId = null
  if (input?.legacyId !== undefined && input?.legacyId !== null) {
    if (typeof input.legacyId !== "string" || !LEGACY_ID_PATTERN.test(input.legacyId)) {
      throw new BackgroundAssetError("Invalid legacy id.", 400, "invalid_legacy_id")
    }
    legacyId = input.legacyId
  }

  const rows = kvList(uid, BACKGROUND_KV_NAMESPACE).filter((row) => row.key.startsWith(ASSET_KEY_PREFIX))
  if (legacyId) {
    const hit = rows.find((row) => row.value && row.value.legacyId === legacyId && readRecord(uid, row.value.id))
    if (hit) return { existing: toPublicMeta(hit.value) }
  }
  if (rows.length >= MAX_ASSETS_PER_USER) {
    throw new BackgroundAssetError(
      `You can keep up to ${MAX_ASSETS_PER_USER} backgrounds. Remove one before adding another.`,
      409,
      "too_many_assets",
    )
  }

  const uploadId = randomBytes(16).toString("hex")
  const paths = sessionPaths(uid, uploadId)
  await fsp.mkdir(paths.dir, { recursive: true, mode: 0o700 })
  await fsp.writeFile(paths.part, "", { flag: "wx", mode: 0o600 })
  await fsp.writeFile(
    paths.meta,
    JSON.stringify({
      ext,
      declaredSize,
      fileName: sanitizeDisplayName(input.fileName),
      legacyId,
      createdAt: new Date().toISOString(),
    }),
    { flag: "wx", mode: 0o600 },
  )
  return { uploadId, chunkBytes: MAX_CHUNK_BYTES }
}

/**
 * Append one chunk (an async iterable of Uint8Array, e.g. a fetch Request body) at `offset`.
 * The offset must equal the bytes already stored; on any failure the file is truncated back to `offset` so the same
 * chunk can simply be sent again. Returns the new total size.
 */
export async function appendBackgroundUploadChunk(userId, uploadId, offset, source) {
  const { uid } = requireUser(userId)
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new BackgroundAssetError("Invalid offset.", 400, "invalid_offset")
  }
  const id = parseUploadId(uploadId)
  if (!id) throw new BackgroundAssetError("Unknown upload.", 404, "upload_not_found")
  return withSessionLock(id, async () => {
    const { paths, session } = await readSession(uid, id)
    const handle = await fsp.open(paths.part, "r+").catch(() => {
      throw new BackgroundAssetError("Unknown upload.", 404, "upload_not_found")
    })
    let written = 0
    try {
      const current = (await handle.stat()).size
      if (current !== offset) {
        // Not our data to truncate: report and leave the file as it is.
        await handle.close().catch(() => {})
        throw new BackgroundAssetError(`Upload is at byte ${current}, not ${offset}.`, 409, "offset_mismatch")
      }
      let head = Buffer.alloc(0)
      let headChecked = offset > 0
      for await (const piece of source) {
        const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength)
        if (chunk.length === 0) continue
        written += chunk.length
        if (written > MAX_CHUNK_BYTES) {
          throw new BackgroundAssetError("Chunk is too large.", 413, "chunk_too_large")
        }
        if (offset + written > session.declaredSize) {
          throw new BackgroundAssetError("Upload is larger than declared.", 413, "too_large")
        }
        if (!headChecked) {
          head = Buffer.concat([head, chunk.subarray(0, 16)]).subarray(0, 16)
          const verdict = matchesMagicBytes(session.ext, head)
          if (verdict === false) {
            await handle.close().catch(() => {})
            await discardSession(paths)
            throw new BackgroundAssetError("The file content does not match its type.", 415, "content_mismatch")
          }
          if (verdict === true) headChecked = true
        }
        let position = 0
        while (position < chunk.length) {
          const { bytesWritten } = await handle.write(chunk, position, chunk.length - position, offset + written - chunk.length + position)
          position += bytesWritten
        }
      }
      return { sizeBytes: offset + written }
    } catch (error) {
      if (!(error instanceof BackgroundAssetError && error.code === "offset_mismatch")) {
        await handle.truncate(offset).catch(() => {})
      }
      throw error
    } finally {
      await handle.close().catch(() => {})
    }
  })
}

async function readHead(filePath, length) {
  const handle = await fsp.open(filePath, "r")
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Validate the finished upload, rename it into place atomically and record it. */
export async function finishBackgroundUpload(userId, uploadId, options = {}) {
  const { uid } = requireUser(userId)
  const id = parseUploadId(uploadId)
  if (!id) throw new BackgroundAssetError("Unknown upload.", 404, "upload_not_found")
  return withSessionLock(id, async () => {
    const { paths, session } = await readSession(uid, id)
    const stat = await fsp.stat(paths.part).catch(() => null)
    if (!stat) throw new BackgroundAssetError("Unknown upload.", 404, "upload_not_found")
    if (stat.size !== session.declaredSize) {
      throw new BackgroundAssetError(
        `Upload is incomplete (${stat.size} of ${session.declaredSize} bytes).`,
        409,
        "incomplete",
      )
    }
    const head = await readHead(paths.part, 16)
    if (matchesMagicBytes(session.ext, head) !== true) {
      await discardSession(paths)
      throw new BackgroundAssetError("The file content does not match its type.", 415, "content_mismatch")
    }
    const assetId = randomBytes(16).toString("hex")
    const finalPath = assetFilePath(uid, assetId, session.ext)
    await fsp.rename(paths.part, finalPath)
    const record = {
      id: assetId,
      ext: session.ext,
      fileName: session.fileName,
      mimeType: TYPES[session.ext].mimeType,
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
      ...(session.legacyId ? { legacyId: session.legacyId } : {}),
    }
    try {
      kvSet(uid, BACKGROUND_KV_NAMESPACE, kvKeyFor(assetId), record)
      if (options.activate !== false) kvSet(uid, BACKGROUND_KV_NAMESPACE, ACTIVE_KEY, { assetId })
    } catch (error) {
      await fsp.rm(finalPath, { force: true }).catch(() => {})
      throw error
    }
    await fsp.rm(paths.meta, { force: true }).catch(() => {})
    return toPublicMeta(record)
  })
}

export async function abortBackgroundUpload(userId, uploadId) {
  const { uid } = requireUser(userId)
  const id = parseUploadId(uploadId)
  if (!id) return false
  return withSessionLock(id, async () => {
    const paths = sessionPaths(uid, id)
    const existed = fs.existsSync(paths.meta) || fs.existsSync(paths.part)
    await discardSession(paths)
    return existed
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Library: list / active / read / delete / purge
// ---------------------------------------------------------------------------------------------------------------

/**
 * Bring disk and database back in line: files without a row are deleted, rows without a file are dropped, and
 * abandoned upload sessions are swept. Cheap; runs on every list.
 */
export async function reconcileBackgroundAssets(userId) {
  const { uid } = requireUser(userId)
  const dir = backgroundAssetsDir(uid)
  let entries = []
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    entries = []
  }
  const rows = kvList(uid, BACKGROUND_KV_NAMESPACE).filter((row) => row.key.startsWith(ASSET_KEY_PREFIX))
  const known = new Map()
  for (const row of rows) {
    const record = readRecord(uid, String(row.key).slice(ASSET_KEY_PREFIX.length))
    if (record) known.set(record.id, record)
    else kvDelete(uid, BACKGROUND_KV_NAMESPACE, row.key)
  }
  const present = new Set()
  const now = Date.now()
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const full = path.join(dir, entry.name)
    const final = FINAL_FILE_PATTERN.exec(entry.name)
    if (final) {
      const record = known.get(final[1])
      if (record && record.ext === final[2]) {
        present.add(record.id)
      } else {
        // A file renamed into place a moment ago may not have its row yet (finishBackgroundUpload); leave it.
        const stat = await fsp.stat(full).catch(() => null)
        if (stat && now - stat.mtimeMs > ORPHAN_GRACE_MS) await fsp.rm(full, { force: true }).catch(() => {})
      }
      continue
    }
    if (SESSION_FILE_PATTERN.test(entry.name)) {
      const stat = await fsp.stat(full).catch(() => null)
      if (stat && now - stat.mtimeMs > STALE_UPLOAD_MS) await fsp.rm(full, { force: true }).catch(() => {})
      continue
    }
    // Unknown file: nothing here is ours.
    await fsp.rm(full, { force: true }).catch(() => {})
  }
  for (const [id] of known) {
    if (!present.has(id)) kvDelete(uid, BACKGROUND_KV_NAMESPACE, kvKeyFor(id))
  }
  const active = readActiveId(uid)
  if (active && !present.has(active)) kvDelete(uid, BACKGROUND_KV_NAMESPACE, ACTIVE_KEY)
}

function readActiveId(uid) {
  const value = kvGet(uid, BACKGROUND_KV_NAMESPACE, ACTIVE_KEY)
  const id = value && typeof value === "object" ? parseAssetId(value.assetId) : null
  return id
}

export async function listBackgroundAssets(userId) {
  const { uid } = requireUser(userId)
  await reconcileBackgroundAssets(uid)
  const assets = kvList(uid, BACKGROUND_KV_NAMESPACE)
    .filter((row) => row.key.startsWith(ASSET_KEY_PREFIX))
    .map((row) => row.value)
    .filter((value) => value && typeof value === "object" && parseAssetId(value.id))
    .map(toPublicMeta)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { assets, activeId: readActiveId(uid) }
}

export function getActiveBackgroundAssetId(userId) {
  const { uid } = requireUser(userId)
  const active = readActiveId(uid)
  return active && readRecord(uid, active) ? active : null
}

/** Sets (or clears with null) the active asset. Throws 404 for an id that does not exist. */
export function setActiveBackgroundAsset(userId, assetId) {
  const { uid } = requireUser(userId)
  if (assetId === null || assetId === undefined) {
    kvDelete(uid, BACKGROUND_KV_NAMESPACE, ACTIVE_KEY)
    return null
  }
  const id = parseAssetId(assetId)
  if (!id || !readRecord(uid, id)) throw new BackgroundAssetError("Background not found.", 404, "not_found")
  kvSet(uid, BACKGROUND_KV_NAMESPACE, ACTIVE_KEY, { assetId: id })
  return id
}

/**
 * Resolve an asset for serving. Returns `{ meta, mimeType, filePath, size }` or null when the id is invalid, unknown
 * or its file is missing.
 */
export async function statBackgroundAsset(userId, assetId) {
  const { uid } = requireUser(userId)
  const id = parseAssetId(assetId)
  if (!id) return null
  const record = readRecord(uid, id)
  if (!record) return null
  const filePath = assetFilePath(uid, id, record.ext)
  const stat = await fsp.stat(filePath).catch(() => null)
  if (!stat || !stat.isFile()) return null
  return { meta: toPublicMeta(record), mimeType: TYPES[record.ext].mimeType, filePath, size: stat.size }
}

/** Node read stream for bytes [start, end] (inclusive). */
export function openBackgroundAssetStream(filePath, start, end) {
  return fs.createReadStream(filePath, { start, end })
}

export async function deleteBackgroundAsset(userId, assetId) {
  const { uid } = requireUser(userId)
  const id = parseAssetId(assetId)
  if (!id) return false
  const record = readRecord(uid, id)
  if (record) await fsp.rm(assetFilePath(uid, id, record.ext), { force: true })
  const removed = kvDelete(uid, BACKGROUND_KV_NAMESPACE, kvKeyFor(id))
  if (readActiveId(uid) === id) kvDelete(uid, BACKGROUND_KV_NAMESPACE, ACTIVE_KEY)
  return Boolean(record) || removed
}

/** Remove every background file and row for a user (account delete / data purge). */
export async function purgeBackgroundAssets(userId) {
  const { uid } = requireUser(userId)
  await fsp.rm(backgroundAssetsDir(uid), { recursive: true, force: true })
  for (const row of kvList(uid, BACKGROUND_KV_NAMESPACE)) kvDelete(uid, BACKGROUND_KV_NAMESPACE, row.key)
}
