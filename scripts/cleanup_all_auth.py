#!/usr/bin/env python3
import re
import os
import glob

def fix_auth(content):
    """Fix Supabase auth to local auth"""

    # Remove the entire auth block and userId extraction, replace with local user
    # Pattern: auth check + userId (may have stuff in between)
    pattern1 = re.compile(
        r'const\s*{\s*unauthorized,\s*verified\s*}\s*=\s*await\s+requireSupabaseApiUser\([^)]+\)\s*'
        r'if\s*\([^{]+\{[^}]+}\s*'
        r'(?:.*?)'  # anything in between
        r'const\s+userId\s*=\s*verified\.user\.id',
        re.DOTALL
    )

    if pattern1.search(content):
        content = pattern1.sub('const { userId } = await requireLocalUser()', content)
        return content, True

    return content, False

def process_file(filepath):
    """Process a single file"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Skip if already fixed
    if 'requireLocalUser' in content or 'requireSupabaseApiUser' not in content:
        return False

    fixed_content, modified = fix_auth(content)

    if modified:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(fixed_content)
        print(f'✓ Fixed: {filepath}')
        return True

    return False

# Process all TypeScript files in API directory
api_dir = os.path.join('hud', 'app', 'api')
files = glob.glob(f'{api_dir}/**/*.ts', recursive=True)
files = [f for f in files if not f.endswith('.bak')]

fixed_count = 0
for filepath in files:
    if process_file(filepath):
        fixed_count += 1

print(f'\n✅ Fixed {fixed_count} files')
