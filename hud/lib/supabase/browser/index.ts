"use client"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
const supabaseAnonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim()

export const hasSupabaseClientConfig = Boolean(supabaseUrl && supabaseAnonKey)

let cachedClient: SupabaseClient | null = null

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!hasSupabaseClientConfig) {
    throw new Error("Supabase client is not configured for this deployment.")
  }
  if (!cachedClient) {
    cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return cachedClient
}

export const supabaseBrowser = hasSupabaseClientConfig ? getSupabaseBrowserClient() : null
