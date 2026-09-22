import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { resolveDataDir } from "../../../src/db/paths.js"

export const MAX_TASK_ATTACHMENTS = 10
export const MAX_TASK_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_TASK_ATTACHMENTS_TOTAL_BYTES = 25 * 1024 * 1024

export interface ManagedTaskAttachment {
  id: string
  displayName: string
  storedPath: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".html": "text/html",
  ".css": "text/css",
  ".xml": "application/xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
}

function safeSegment(value: string): string {
  const normalized = String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96)
  if (!normalized) throw new Error("Invalid attachment storage identifier.")
  return normalized
}

function safeDisplayName(sourcePath: string): string {
  return path.basename(sourcePath).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "attachment"
}

export function taskAttachmentDir(userId: string, taskId: string): string {
  return path.join(resolveDataDir(), "agent-task-files", safeSegment(userId), safeSegment(taskId))
}

export async function ingestTaskAttachments(
  userId: string,
  taskId: string,
  sourcePaths: readonly string[],
): Promise<ManagedTaskAttachment[]> {
  const uniquePaths = [...new Set(sourcePaths.map((entry) => String(entry || "").trim()).filter(Boolean))]
  if (uniquePaths.length > MAX_TASK_ATTACHMENTS) {
    throw new Error(`A task can include at most ${MAX_TASK_ATTACHMENTS} attachments.`)
  }
  if (uniquePaths.length === 0) return []

  const destinationDir = taskAttachmentDir(userId, taskId)
  await fs.mkdir(destinationDir, { recursive: true, mode: 0o700 })
  const managed: ManagedTaskAttachment[] = []
  let totalBytes = 0

  try {
    for (const sourcePath of uniquePaths) {
      if (!path.isAbsolute(sourcePath)) throw new Error("Attachment paths must be absolute.")
      const linkStat = await fs.lstat(sourcePath)
      if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
        throw new Error(`Attachment "${safeDisplayName(sourcePath)}" must be a regular file.`)
      }

      const realSourcePath = await fs.realpath(sourcePath)
      const handle = await fs.open(realSourcePath, fsConstants.O_RDONLY)
      let content: Buffer
      try {
        const before = await handle.stat()
        if (!before.isFile()) throw new Error(`Attachment "${safeDisplayName(sourcePath)}" is not a regular file.`)
        if (before.size > MAX_TASK_ATTACHMENT_BYTES) {
          throw new Error(`Attachment "${safeDisplayName(sourcePath)}" exceeds the 10 MB limit.`)
        }
        totalBytes += before.size
        if (totalBytes > MAX_TASK_ATTACHMENTS_TOTAL_BYTES) {
          throw new Error("Task attachments exceed the 25 MB combined limit.")
        }
        content = await handle.readFile()
        const after = await handle.stat()
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || content.length !== before.size) {
          throw new Error(`Attachment "${safeDisplayName(sourcePath)}" changed while it was being copied.`)
        }
      } finally {
        await handle.close()
      }

      const id = randomUUID()
      const displayName = safeDisplayName(sourcePath)
      const extension = path.extname(displayName).toLowerCase().slice(0, 12)
      const absoluteStoredPath = path.join(destinationDir, `${id}${extension}`)
      await fs.writeFile(absoluteStoredPath, content, { flag: "wx", mode: 0o600 })
      managed.push({
        id,
        displayName,
        storedPath: path.relative(resolveDataDir(), absoluteStoredPath),
        mimeType: MIME_BY_EXTENSION[extension] || "application/octet-stream",
        sizeBytes: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
      })
    }
    return managed
  } catch (error) {
    await fs.rm(destinationDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export async function deleteTaskAttachmentFiles(userId: string, taskId: string): Promise<void> {
  await fs.rm(taskAttachmentDir(userId, taskId), { recursive: true, force: true })
}
