/**
 * Local-only user authentication
 * Replaces Supabase auth with simple local user model
 */

import "server-only"

export const LOCAL_USER_ID = "local-user"

export interface LocalUser {
  id: string
  email: string
}

/**
 * Get the local user (always succeeds in local-only mode)
 */
export async function getLocalUser(): Promise<LocalUser> {
  return {
    id: LOCAL_USER_ID,
    email: "local@novaai.local",
  }
}

/**
 * Drop-in replacement for requireSupabaseApiUser
 * Returns local user without authentication
 */
export async function requireLocalUser() {
  const user = await getLocalUser()

  return {
    user,
    userId: user.id,
  }
}
