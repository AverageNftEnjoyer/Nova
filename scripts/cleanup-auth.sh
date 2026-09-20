#!/bin/bash
cd /c/Nova

# Process each file
process_file() {
    local file="$1"
    
    # Skip if already processed
    if grep -q "requireLocalUser" "$file" 2>/dev/null; then
        echo "⏭ Skip: $file (already processed)"
        return
    fi
    
    if ! grep -q "requireSupabaseApiUser" "$file" 2>/dev/null; then
        return
    fi
    
    # Create backup
    cp "$file" "$file.bak"
    
    # Replace import
    sed -i 's|import { requireSupabaseApiUser } from "@/lib/supabase/server"|import { requireLocalUser } from "@/lib/auth/local-user"|g' "$file"
    
    # Pattern 1: Standard auth check with userId extraction
    sed -i ':a;N;$!ba;s/const { unauthorized, verified } = await requireSupabaseApiUser(req)\n  if (unauthorized || !verified?.user?.id) [^\n]*\n  const userId = verified\.user\.id/const { userId } = await requireLocalUser()/g' "$file"
    
    # Pattern 2: Auth check with return
    sed -i ':a;N;$!ba;s/const { unauthorized, verified } = await requireSupabaseApiUser(req)\n  if (unauthorized || !verified?.user?.id) return [^\n]*/const { userId } = await requireLocalUser()/g' "$file"
    
    # Change req to _req if not used
    if ! grep -q "req\." "$file" && grep -q "async function.*req:" "$file"; then
        sed -i 's/async function \([^(]*\)(req:/async function \1(_req:/g' "$file"
        sed -i 's/export async function \([A-Z]*\)(req:/export async function \1(_req:/g' "$file"
    fi
    
    echo "✓ Processed: $file"
}

# Export function
export -f process_file

# Find and process all files
find hud/app/api -name "*.ts" -type f -exec bash -c 'process_file "$0"' {} \;

echo ""
echo "Cleanup complete!"
