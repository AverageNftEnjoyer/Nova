import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

function getAllFiles(dir, files = []) {
  const items = readdirSync(dir)
  for (const item of items) {
    const fullPath = join(dir, item)
    if (statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, files)
    } else if (item.endsWith('.ts') && !item.endsWith('.bak')) {
      files.push(fullPath)
    }
  }
  return files
}

function fixFile(filePath) {
  let content = readFileSync(filePath, 'utf-8')
  let modified = false

  // Check if already has requireLocalUser
  if (content.includes('requireLocalUser')) {
    return false
  }

  // Check if has requireSupabaseApiUser calls (not just import)
  if (!content.includes('await requireSupabaseApiUser')) {
    return false
  }

  // Pattern: Standard auth check
  const pattern1 = /const\s*{\s*unauthorized,\s*verified\s*}\s*=\s*await\s+requireSupabaseApiUser\(req\)\s+if\s*\(unauthorized\s*\|\|\s*!verified\?\.user\?\.id\)[^\n]+\s+const\s+userId\s*=\s*verified\.user\.id/gs
  if (pattern1.test(content)) {
    content = content.replace(pattern1, 'const { userId } = await requireLocalUser()')
    modified = true
  }

  // Pattern: Auth check with immediate return
  const pattern2 = /const\s*{\s*unauthorized,\s*verified\s*}\s*=\s*await\s+requireSupabaseApiUser\(req\)\s+if\s*\(unauthorized\s*\|\|\s*!verified\?\.user\?\.id\)\s+return[^\n]+\s+const\s+userId\s*=\s*verified\.user\.id/gs
  if (pattern2.test(content)) {
    content = content.replace(pattern2, 'const { userId } = await requireLocalUser()')
    modified = true
  }

  // Replace remaining direct calls
  content = content.replace(
    /const\s+userId\s*=\s*verified\.user\.id/g,
    'const { userId } = await requireLocalUser()'
  )

  // Remove auth checks
  content = content.replace(
    /const\s*{\s*unauthorized,\s*verified\s*}\s*=\s*await\s+requireSupabaseApiUser\([^)]+\)\s*/g,
    ''
  )
  content = content.replace(
    /if\s*\(unauthorized\s*\|\|\s*!verified\?\.user\?\.id\)[^\n]+\n/g,
    ''
  )

  if (modified || content !== readFileSync(filePath, 'utf-8')) {
    writeFileSync(filePath, content, 'utf-8')
    console.log(`✓ Fixed: ${filePath}`)
    return true
  }

  return false
}

const apiDir = join(process.cwd(), 'hud', 'app', 'api')
const files = getAllFiles(apiDir)
let fixed = 0

for (const file of files) {
  if (fixFile(file)) fixed++
}

console.log(`\n✅ Fixed ${fixed} files`)
