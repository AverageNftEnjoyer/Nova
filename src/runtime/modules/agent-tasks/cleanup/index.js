import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getDb } from "../../../../db/index.js";
import { resolveDataDir, resolveWorkspaceRoot } from "../../../../db/paths.js";

const execFileAsync = promisify(execFile);

function safeSegment(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(normalized)) throw new Error("Unsafe task cleanup identifier.");
  return normalized;
}

function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function cleanupOneTask(row) {
  const userId = safeSegment(row.user_id);
  const taskId = safeSegment(row.id);
  const repositoryRoot = resolveWorkspaceRoot();
  if (row.worktree_path) {
    const expectedWorktree = path.join(repositoryRoot, ".worktrees", taskId);
    if (!samePath(row.worktree_path, expectedWorktree)) {
      throw new Error("Refusing to remove a task worktree outside the managed directory.");
    }
    const exists = await fs.stat(expectedWorktree).then((stat) => stat.isDirectory()).catch(() => false);
    if (exists) {
      await execFileAsync("git", ["worktree", "remove", "--force", expectedWorktree], {
        cwd: repositoryRoot,
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
    } else {
      await execFileAsync("git", ["worktree", "prune"], {
        cwd: repositoryRoot,
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
    }
  }

  const attachmentDir = path.join(resolveDataDir(), "agent-task-files", userId, taskId);
  await fs.rm(attachmentDir, { recursive: true, force: true });
  getDb().prepare(
    `DELETE FROM agent_tasks
     WHERE user_id = ? AND id = ? AND deleted_at IS NOT NULL
       AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at < ?)`,
  ).run(userId, taskId, new Date().toISOString());
}

export async function finalizeDeferredTaskDeletes() {
  const now = new Date().toISOString();
  const rows = getDb().prepare(
    `SELECT user_id, id, worktree_path
     FROM agent_tasks
     WHERE deleted_at IS NOT NULL
       AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at < ?)
     ORDER BY deleted_at ASC
     LIMIT 10`,
  ).all(now);
  for (const row of rows) {
    try {
      await cleanupOneTask(row);
    } catch (error) {
      console.error(`[AgentTasks] Deferred cleanup failed task=${String(row.id)}: ${String(error?.message || error)}`);
    }
  }
}
