#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises'
import { glob } from 'glob'

const LOCAL_USER_ID = 'local-user'

async function cleanupFile(filePath) {
  let content = await readFile(filePath, 'utf-8')
  let modified = false

  // Remove import
  if (content.includes('requireSupabaseApiUser')) {
    content = content.replace(
      /import\s*{\s*requireSupabaseApiUser\s*}\s*from\s*["']@\/lib\/supabase\/server["']\s*\n?/g,
      ''
    )
    modified = true
  }

  // Pattern 1: Basic auth check
  // const { unauthorized, verified } = await requireSupabaseApiUser(req)
  // if (unauthorized || !verified?.user?.id) return ...
  // const userId = verified.user.id
  const authPattern1 = /const\s*{\s*unauthorized,\s*verified\s*}\s*=\s*await\s+requireSupabaseApiUser\([^)]*\)\s*\n\s*if\s*\([^)]*unauthorized[^)]*\)[^}]*}\s*\n\s*const\s+userId\s*=\s*verified\.user\.id/gs

  if (authPattern1.test(content)) {
    content = content.replace(authPattern1, `const userId = "${LOCAL_USER_ID}"`)
    modified = true
  }

  // Pattern 2: Multi-line auth check
  const authPattern2 = /const\s*{\s*unauthorized,\s*verified\s*}\s*=\s*await\s+requireSupabaseApiUser\([^)]*\)\s*\n\s*if\s*\([^{]*{[^}]*}[^}]*\n\s*const\s+userId\s*=\s*verified\.user\.id/gs

  if (authPattern2.test(content)) {
    content = content.replace(authPattern2, `const userId = "${LOCAL_USER_ID}"`)
    modified = true
  }

  // Pattern 3: Just the auth check without userId after
  const authPattern3 = /const\s*{\s*unauthorized,\s*verified\s*}\s*=\s*await\s+requireSupabaseApiUser\([^)]*\)\s*\n\s*if\s*\([^)]*unauthorized[^)]*\)[^{]*{[^}]*}/gs

  if (authPattern3.test(content)) {
    content = content.replace(authPattern3, `// Local-only mode - no authentication`)
    modified = true
  }

  // Pattern 4: userId extraction
  const userIdPattern = /const\s+userId\s*=\s*verified\.user\.id/g
  if (userIdPattern.test(content)) {
    content = content.replace(userIdPattern, `const userId = "${LOCAL_USER_ID}"`)
    modified = true
  }

  // Add local-user constant at top if userId is used
  if (content.includes('userId') && !content.includes('const LOCAL_USER_ID')) {
    // Find first import and add after
    const firstImport = content.indexOf('import')
    if (firstImport !== -1) {
      const firstNewline = content.indexOf('\n\n', firstImport)
      if (firstNewline !== -1) {
        const before = content.substring(0, firstNewline + 2)
        const after = content.substring(firstNewline + 2)
        content = before + `// Local-only user ID\nconst LOCAL_USER_ID = "${LOCAL_USER_ID}"\n\n` + after
        modified = true
      }
    }
  }

  if (modified) {
    await writeFile(filePath, content, 'utf-8')
    console.log(`✓ Cleaned: ${filePath}`)
    return true
  }

  return false
}

async function main() {
  const files = await glob('hud/app/api/**/*.ts', { cwd: process.cwd() })
  let cleanedCount = 0

  for (const file of files) {
    try {
      const cleaned = await cleanupFile(file)
      if (cleaned) cleanedCount++
    } catch (error) {
      console.error(`✗ Failed: ${file}`, error.message)
    }
  }

  console.log(`\nCleaned ${cleanedCount} files`)
}

main().catch(console.error)
