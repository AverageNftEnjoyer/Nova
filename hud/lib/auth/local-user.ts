/**
 * Local-only user authentication
 * Fixed local user model (no remote authentication)
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
 * Local identity helper for desktop/local-only mode.
 * Returns the fixed local user without network authentication.
 */
export async function requireLocalUser() {
  const user = await getLocalUser()

  return {
    user,
    userId: user.id,
  }
}
