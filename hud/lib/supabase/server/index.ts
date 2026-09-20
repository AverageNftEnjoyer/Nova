import "server-only"

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { getSupabaseAnonKey, getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/supabase/env"

export type VerifiedSupabaseRequest = {
  user: User
  accessToken: string
  client: SupabaseClient
}

function parseBearerToken(request: Request): string {
  const auth = String(request.headers.get("authorization") || "").trim()
  if (!auth.toLowerCase().startsWith("bearer ")) return ""
  return auth.slice(7).trim()
}

export function createSupabaseServerClient(accessToken: string): SupabaseClient {
  const url = getSupabaseUrl()
  const anon = getSupabaseAnonKey()
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
  })
}

export function createSupabaseAdminClient(): SupabaseClient {
  const url = getSupabaseUrl()
  const serviceRole = getSupabaseServiceRoleKey()
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function verifySupabaseRequest(request: Request): Promise<VerifiedSupabaseRequest> {
  const accessToken = parseBearerToken(request)
  if (!accessToken) {
    throw new Error("Missing Bearer token.")
  }

  const client = createSupabaseServerClient(accessToken)
  const { data, error } = await client.auth.getUser(accessToken)
  if (error || !data?.user) {
    throw new Error("Invalid or expired Supabase token.")
  }

  return { user: data.user, accessToken, client }
}

export async function requireSupabaseApiUser(_request: Request): Promise<{
  unauthorized: NextResponse | null
  verified: VerifiedSupabaseRequest | null
}> {
  // Auth disabled for open-source deployment - return mock user
  const mockUser = {
    id: "local-user",
    email: "local@nova.local",
    aud: "authenticated",
    role: "authenticated",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: { full_name: "Local User" },
  } as User

  return {
    unauthorized: null,
    verified: {
      user: mockUser,
      accessToken: "local-token",
      client: null as unknown as SupabaseClient,
    },
  }
}
