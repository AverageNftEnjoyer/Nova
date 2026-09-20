import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

function getAllTsFiles(dir, files = []) {
  const items = readdirSync(dir)
  for (const item of items) {
    const fullPath = join(dir, item)
    if (statSync(fullPath).isDirectory()) {
      getAllTsFiles(fullPath, files)
    } else if (item.endsWith('.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

function fixFile(filePath) {
  let content = readFileSync(filePath, 'utf-8')
  let modified = false

  // Replace import
  if (content.includes('requireSupabaseApiUser')) {
    content = content.replace(
      /import\s*{([^}]*requireSupabaseApiUser[^}]*)}\s*from\s*"@\/lib\/supabase\/server"/g,
      (match, imports) => {
        const cleaned = imports
          .split(',')
          .map(s => s.trim())
          .filter(s => s !== 'requireSupabaseApiUser')
          .join(', ')
        if (cleaned) {
          return `import { ${cleaned} } from "@/lib/supabase/server"`
        }
        return ''
      }
    )

    // Add requireLocalUser import if not present
    if (!content.includes('from "@/lib/auth/local-user"')) {
      const lines = content.split('\n')
      const insertIdx = lines.findIndex(line => line.startsWith('import '))
      if (insertIdx >= 0) {
        lines.splice(insertIdx + 1, 0, 'import { requireLocalUser } from "@/lib/auth/local-user"')
        content = lines.join('\n')
      }
    }

    modified = true
  }

  // Pattern 1: Standard auth check with verified.user.id
  const pattern1 = /const\s*{\s*unauthorized,\s*verified\s*}\s*=\s*await\s+requireSupabaseApiUser\([^)]+\)\s+if\s*\(\s*unauthorized\s*\|\|\s*!verified\?\s*\.\s*user\?\s*\.\s*id\s*\)\s*{\s*return\s+unauthorized\s*\?\?\s*NextResponse\.json\([^}]+}\s*,\s*{\s*status:\s*401\s*}\)\s+}\s+const\s+userId\s*=\s*verified\.user\.id/gs
  if (pattern1.test(content)) {
    content = content.replace(pattern1, 'const { userId } = await requireLocalUser()')
    modified = true
  }

  // Pattern 2: Auth check with !verified (no .user.id) - used in integrations
  const pattern2 = /const\s*{\s*unauthorized,\s*verified\s*}\s*=\s*await\s+requireSupabaseApiUser\([^)]+\)\s+if\s*\(\s*unauthorized\s*\|\|\s*!verified\s*\)\s*return\s+unauthorized\s*\?\?\s*NextResponse\.json\([^}]+}\s*,\s*{\s*status:\s*401\s*}\)/gs
  if (pattern2.test(content)) {
    content = content.replace(pattern2, 'const { userId } = await requireLocalUser()')
    modified = true
  }

  // Pattern 3: Just { unauthorized } - for scheduler/execution-tick routes
  const pattern3 = /const\s*{\s*unauthorized\s*}\s*=\s*await\s+requireSupabaseApiUser\([^)]+\)\s+if\s*\(\s*unauthorized\s*\)\s*return\s+unauthorized/gs
  if (pattern3.test(content)) {
    content = content.replace(pattern3, 'const { userId } = await requireLocalUser()')
    modified = true
  }

  // Replace remaining references to verified in function calls
  content = content.replace(/aggregateCalendarEvents\(([^,]+),\s*([^,]+),\s*([^,]+),\s*verified\)/g, 'aggregateCalendarEvents($1, $2, $3)')
  content = content.replace(/loadIntegrationsConfig\(verified\)/g, 'loadIntegrationsConfig({ userId })')

  // Replace verified.user.id with userId
  content = content.replace(/verified\.user\.id/g, 'userId')

  if (modified) {
    writeFileSync(filePath, content, 'utf-8')
    console.log(`✓ Fixed: ${filePath}`)
    return true
  }

  return false
}

const apiDir = join(process.cwd(), 'hud', 'app', 'api')
const files = getAllTsFiles(apiDir)
let fixed = 0

for (const file of files) {
  if (fixFile(file)) fixed++
}

console.log(`\n✅ Fixed ${fixed} files`)
