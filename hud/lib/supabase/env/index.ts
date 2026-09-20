import "server-only"

function read(name: string): string {
  return String(process.env[name] || "").trim()
}

export function hasSupabaseConfig(): boolean {
  const url = read("SUPABASE_URL") || read("NEXT_PUBLIC_SUPABASE_URL")
  const key = read("SUPABASE_ANON_KEY") || read("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  return Boolean(url && key)
}

export function getSupabaseUrl(): string {
  const value = read("SUPABASE_URL") || read("NEXT_PUBLIC_SUPABASE_URL")
  if (!value) return "http://localhost:54321"
  return value
}

export function getSupabaseAnonKey(): string {
  const value = read("SUPABASE_ANON_KEY") || read("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  if (!value) return "local-anon-key"
  return value
}

export function getSupabaseServiceRoleKey(): string {
  const value = read("SUPABASE_SERVICE_ROLE_KEY")
  if (!value) return "local-service-role-key"
  return value
}
