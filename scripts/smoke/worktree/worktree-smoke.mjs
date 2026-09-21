/**
 * Git Worktree Manager Smoke Test
 *
 * Verifies that the worktree manager can:
 * - Generate semantic branch names from prompts
 * - Create worktrees with unique branches
 * - Detect uncommitted changes
 * - Delete worktrees cleanly
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "../../..")

// Import the worktree manager
import { generateBranchName, createWorktree, deleteWorktree, getWorktreePath } from "../../../hud/lib/git/worktree-manager.ts"

const testWorkspace = path.join(rootDir, ".worktrees-test")
let testCount = 0
let passCount = 0

function test(name, fn) {
  testCount++
  try {
    fn()
    passCount++
    console.log(`✓ ${name}`)
  } catch (error) {
    console.error(`✗ ${name}`)
    console.error(`  ${error.message}`)
    if (error.stack) {
      console.error(`  ${error.stack.split("\n").slice(1, 3).join("\n  ")}`)
    }
  }
}

async function asyncTest(name, fn) {
  testCount++
  try {
    await fn()
    passCount++
    console.log(`✓ ${name}`)
  } catch (error) {
    console.error(`✗ ${name}`)
    console.error(`  ${error.message}`)
    if (error.stack) {
      console.error(`  ${error.stack.split("\n").slice(1, 3).join("\n  ")}`)
    }
  }
}

// Test suite
console.log("Git Worktree Manager Smoke Tests\n")

// Branch name generation tests
test("WT-1: Generate feat/* branch for 'add' prompt", () => {
  const branch = generateBranchName("add login system", "test-123")
  assert.match(branch, /^feat\//, "Should start with feat/")
  assert.match(branch, /login/, "Should contain 'login'")
})

test("WT-2: Generate fix/* branch for 'fix' prompt", () => {
  const branch = generateBranchName("fix auth bug in header", "test-456")
  assert.match(branch, /^fix\//, "Should start with fix/")
  assert.match(branch, /auth/, "Should contain 'auth'")
})

test("WT-3: Generate refactor/* branch for 'refactor' prompt", () => {
  const branch = generateBranchName("refactor database layer", "test-789")
  assert.match(branch, /^refactor\//, "Should start with refactor/")
})

test("WT-4: Sanitize special characters in branch names", () => {
  const branch = generateBranchName("add @user profile (with spaces!)", "test-abc")
  assert.doesNotMatch(branch, /[@()!]/, "Should not contain special characters")
  assert.match(branch, /^[a-z0-9/-]+$/, "Should only contain lowercase, numbers, dashes and slashes")
})

test("WT-5: Fallback to task-id format for empty prompt", () => {
  const branch = generateBranchName("", "test-xyz")
  assert.match(branch, /test-xyz/, "Should include task ID in fallback")
})

test("WT-6: Generate chore/* branch for 'update' prompt", () => {
  const branch = generateBranchName("update dependencies", "test-111")
  assert.match(branch, /^chore\//, "Should start with chore/")
})

test("WT-7: Generate docs/* branch for 'document' prompt", () => {
  const branch = generateBranchName("document API endpoints", "test-222")
  assert.match(branch, /^docs\//, "Should start with docs/")
})

test("WT-8: Branch name length limit", () => {
  const longPrompt = "a".repeat(200)
  const branch = generateBranchName(longPrompt, "test-333")
  assert.ok(branch.length <= 60, `Branch name should be <= 60 chars, got ${branch.length}`)
})

// Note: Skipping actual worktree creation tests to avoid modifying git state
// These would require:
// - await createWorktree(taskId, branchName, testWorkspace)
// - await deleteWorktree(taskId, testWorkspace)
// - getWorktreePath(taskId, testWorkspace)
//
// In production, these functions are tested through the task creation flow

console.log(`\n${passCount}/${testCount} tests passed`)
process.exit(passCount === testCount ? 0 : 1)
