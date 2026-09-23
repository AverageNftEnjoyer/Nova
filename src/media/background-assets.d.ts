export interface BackgroundAssetPublicMeta {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

export type BackgroundAssetSource = AsyncIterable<Uint8Array>

export const BACKGROUND_KV_NAMESPACE: "background-assets"
export const MAX_VIDEO_BYTES: number
export const MAX_IMAGE_BYTES: number
export const MAX_CHUNK_BYTES: number
export const MAX_ASSETS_PER_USER: number
export const STALE_UPLOAD_MS: number

export class BackgroundAssetError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string)
}

export type RangeResult =
  | { kind: "none" }
  | { kind: "range"; start: number; end: number }
  | { kind: "unsatisfiable" }

export function parseAssetId(value: unknown): string | null
export function parseUploadId(value: unknown): string | null
export function extensionOf(fileName: unknown): string | null
export function mimeTypeForExtension(ext: string): string | null
export function maxBytesForExtension(ext: string): number
export function sanitizeDisplayName(fileName: unknown): string
export function matchesMagicBytes(ext: string, head: Uint8Array): boolean | null
export function parseRangeHeader(header: string | null | undefined, size: number): RangeResult
export function normalizeUserSegment(userId: unknown): string
export function backgroundAssetsDir(userId: string): string

export function beginBackgroundUpload(
  userId: string,
  input: { fileName?: unknown; sizeBytes?: unknown; legacyId?: unknown },
): Promise<{ uploadId: string; chunkBytes: number } | { existing: BackgroundAssetPublicMeta }>
export function appendBackgroundUploadChunk(
  userId: string,
  uploadId: string,
  offset: number,
  source: BackgroundAssetSource,
): Promise<{ sizeBytes: number }>
export function finishBackgroundUpload(
  userId: string,
  uploadId: string,
  options?: { activate?: boolean },
): Promise<BackgroundAssetPublicMeta>
export function abortBackgroundUpload(userId: string, uploadId: string): Promise<boolean>

export function reconcileBackgroundAssets(userId: string): Promise<void>
export function listBackgroundAssets(userId: string): Promise<{ assets: BackgroundAssetPublicMeta[]; activeId: string | null }>
export function getActiveBackgroundAssetId(userId: string): string | null
export function setActiveBackgroundAsset(userId: string, assetId: string | null | undefined): string | null
export function statBackgroundAsset(
  userId: string,
  assetId: unknown,
): Promise<{ meta: BackgroundAssetPublicMeta; mimeType: string; filePath: string; size: number } | null>
export function openBackgroundAssetStream(filePath: string, start: number, end: number): import("node:fs").ReadStream
export function deleteBackgroundAsset(userId: string, assetId: unknown): Promise<boolean>
export function purgeBackgroundAssets(userId: string): Promise<void>
