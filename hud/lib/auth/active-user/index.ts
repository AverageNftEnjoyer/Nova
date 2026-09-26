const ACTIVE_USER_STORAGE_KEY = "nova_active_user_id"
export const ACTIVE_USER_CHANGED_EVENT = "nova:active-user-changed"

export function getActiveUserId(): string {
  if (typeof window === "undefined") return "local-user"
  try {
    const stored = String(localStorage.getItem(ACTIVE_USER_STORAGE_KEY) || "").trim()
    return stored || "local-user"
  } catch {
    return "local-user"
  }
}
