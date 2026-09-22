/**
 * Git Worktree Manager
 *
 * Manages isolated git worktrees for agent tasks, enabling multiple agents
 * to work in parallel without conflicts in the working directory.
 */

import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

import { resolveWorkspaceRoot } from "../../../src/db/paths.js"

export class WorktreeError extends Error {
  public readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "WorktreeError"
    this.cause = cause
  }
}

interface ExecGitResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Execute a git command and return its output.
 */
function execGit(args: string[], cwd?: string): Promise<ExecGitResult> {
  return new Promise((resolve) => {
    const git = spawn("git", args, {
      cwd: cwd || resolveWorkspaceRoot(),
      shell: false,
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""

    git.stdout.on("data", (data: Buffer) => {
      stdout += data.toString()
    })

    git.stderr.on("data", (data: Buffer) => {
      stderr += data.toString()
    })

    git.on("close", (exitCode) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: exitCode ?? 1 })
    })

    git.on("error", (error) => {
      resolve({ stdout, stderr: error.message, exitCode: 1 })
    })
  })
}

/**
 * Sanitize a prompt into a git-safe branch name.
 * Format: kebab-case, alphanumeric + dash only
 */
function sanitizeBranchName(text: string, maxLength: number = 50): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // Remove non-alphanumeric (except spaces and dashes)
    .replace(/\s+/g, "-") // Replace spaces with dashes
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/^-|-$/g, "") // Remove leading/trailing dashes
    .slice(0, maxLength)
}

/**
 * Generate a semantic branch name from a task prompt using a simple heuristic.
 * Falls back to task-<timestamp> if generation fails.
 *
 * TODO: In Phase 4, replace with actual LLM call to generate semantic names
 * like "feat/add-login-system" or "fix/auth-bug"
 */
export function generateBranchName(prompt: string, taskId: string): string {
  try {
    // Simple heuristic: extract action words and generate a semantic name
    const lowerPrompt = prompt.toLowerCase()
    let prefix = "task"

    // Detect common action patterns
    if (/^(add|create|build|implement)/i.test(prompt)) {
      prefix = "feat"
    } else if (/^(fix|repair|resolve|correct)/i.test(prompt)) {
      prefix = "fix"
    } else if (/^(refactor|clean|reorganize|restructure)/i.test(prompt)) {
      prefix = "refactor"
    } else if (/^(update|modify|change|improve)/i.test(prompt)) {
      prefix = "chore"
    } else if (/^(test|verify)/i.test(prompt)) {
      prefix = "test"
    } else if (/^(document|doc|write)/i.test(prompt)) {
      prefix = "docs"
    }

    // Extract meaningful words (skip common words)
    const skipWords = new Set(["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by"])
    const words = prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !skipWords.has(w))
      .slice(0, 4) // Take first 4 meaningful words

    if (words.length === 0) {
      // Fallback to task ID
      return `${prefix}-${taskId.slice(0, 8)}`
    }

    const description = sanitizeBranchName(words.join(" "), 40)
    return `${prefix}/${description}-${taskId.slice(0, 8)}`
  } catch {
    // Fallback to timestamped branch name
    return `task-${taskId.slice(0, 8)}-${Date.now()}`
  }
}

/**
 * Create a new git worktree for an agent task.
 *
 * @param taskId - Unique task identifier
 * @param branchName - Git branch name for the worktree
 * @param baseDir - Base directory for worktrees (defaults to .worktrees/)
 * @returns Absolute path to the created worktree
 */
export async function createWorktree(taskId: string, branchName: string, baseDir?: string): Promise<string> {
  const repoRoot = resolveWorkspaceRoot()
  const worktreesDir = baseDir || path.join(repoRoot, ".worktrees")
  const worktreePath = path.join(worktreesDir, taskId)

  // Ensure .worktrees directory exists
  if (!fs.existsSync(worktreesDir)) {
    fs.mkdirSync(worktreesDir, { recursive: true })
  }

  // Check if worktree path already exists
  if (fs.existsSync(worktreePath)) {
    throw new WorktreeError(`Worktree path already exists: ${worktreePath}`)
  }

  // Check if branch already exists
  const checkBranch = await execGit(["branch", "--list", branchName])
  const branchExists = checkBranch.stdout.trim().length > 0

  if (branchExists) {
    // If branch exists, use it without -b flag
    const result = await execGit(["worktree", "add", worktreePath, branchName])
    if (result.exitCode !== 0) {
      throw new WorktreeError(`Failed to create worktree: ${result.stderr}`, result)
    }
  } else {
    // Create new branch with -b flag
    const result = await execGit(["worktree", "add", "-b", branchName, worktreePath])
    if (result.exitCode !== 0) {
      throw new WorktreeError(`Failed to create worktree with new branch: ${result.stderr}`, result)
    }
  }

  return worktreePath
}

/**
 * Check if a worktree has uncommitted changes.
 */
export async function checkUncommittedChanges(worktreePath: string): Promise<boolean> {
  if (!fs.existsSync(worktreePath)) {
    return false
  }

  const result = await execGit(["status", "--porcelain"], worktreePath)
  return result.stdout.trim().length > 0
}

/**
 * Delete a git worktree.
 *
 * @param taskId - Task identifier
 * @param baseDir - Base directory for worktrees (defaults to .worktrees/)
 * @param force - Force deletion even with uncommitted changes
 * @throws WorktreeError if worktree has uncommitted changes and force is false
 */
export async function deleteWorktree(taskId: string, baseDir?: string, force: boolean = false): Promise<void> {
  const repoRoot = resolveWorkspaceRoot()
  const worktreesDir = baseDir || path.join(repoRoot, ".worktrees")
  const worktreePath = path.join(worktreesDir, taskId)

  if (!fs.existsSync(worktreePath)) {
    // Already removed, no-op
    return
  }

  // Check for uncommitted changes unless force is true
  if (!force) {
    const hasChanges = await checkUncommittedChanges(worktreePath)
    if (hasChanges) {
      throw new WorktreeError("Worktree has uncommitted changes. Commit or discard them first, or use force=true.")
    }
  }

  // Remove the worktree
  const result = await execGit(force ? ["worktree", "remove", "--force", worktreePath] : ["worktree", "remove", worktreePath])
  if (result.exitCode !== 0) {
    throw new WorktreeError(`Failed to remove worktree: ${result.stderr}`, result)
  }
}

/**
 * Get the path to an existing worktree for a task.
 *
 * @returns Absolute path to the worktree, or null if it doesn't exist
 */
export function getWorktreePath(taskId: string, baseDir?: string): string | null {
  const repoRoot = resolveWorkspaceRoot()
  const worktreesDir = baseDir || path.join(repoRoot, ".worktrees")
  const worktreePath = path.join(worktreesDir, taskId)

  return fs.existsSync(worktreePath) ? worktreePath : null
}

/**
 * List all active worktrees.
 */
export async function listWorktrees(): Promise<Array<{ path: string; branch: string; commit: string }>> {
  const result = await execGit(["worktree", "list", "--porcelain"])
  if (result.exitCode !== 0) {
    throw new WorktreeError(`Failed to list worktrees: ${result.stderr}`, result)
  }

  const worktrees: Array<{ path: string; branch: string; commit: string }> = []
  const lines = result.stdout.split("\n")
  let current: { path?: string; branch?: string; commit?: string } = {}

  for (const line of lines) {
    if (!line.trim()) {
      if (current.path && current.branch && current.commit) {
        worktrees.push(current as { path: string; branch: string; commit: string })
      }
      current = {}
      continue
    }

    if (line.startsWith("worktree ")) {
      current.path = line.substring(9)
    } else if (line.startsWith("branch ")) {
      current.branch = line.substring(7).replace(/^refs\/heads\//, "")
    } else if (line.startsWith("HEAD ")) {
      current.commit = line.substring(5)
    }
  }

  // Handle last entry
  if (current.path && current.branch && current.commit) {
    worktrees.push(current as { path: string; branch: string; commit: string })
  }

  return worktrees
}

/**
 * Prune stale worktree administrative files.
 * Run this periodically to clean up metadata for manually deleted worktrees.
 */
export async function pruneWorktrees(): Promise<void> {
  const result = await execGit(["worktree", "prune"])
  if (result.exitCode !== 0) {
    throw new WorktreeError(`Failed to prune worktrees: ${result.stderr}`, result)
  }
}
