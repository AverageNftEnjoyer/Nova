import "server-only"

function read(name: string): string {
  return String(process.env[name] || "").trim()
}

export function getSupabaseUrl(): string {
  const value = read("SUPABASE_URL") || read("NEXT_PUBLIC_SUPABASE_URL")
  if (!value) throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).")
  return value
}

export function getSupabaseAnonKey(): string {
  const value = read("SUPABASE_ANON_KEY") || read("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  if (!value) throw new Error("Missing SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).")
  return value
}

export function getSupabaseServiceRoleKey(): string {
  const value = read("SUPABASE_SERVICE_ROLE_KEY")
  if (!value) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.")
  return value
}
