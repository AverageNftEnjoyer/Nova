const ACTIVE_USER_STORAGE_KEY = "nova_active_user_id"

export function getActiveUserId(): string {
  if (typeof window === "undefined") return ""
  try {
    return String(localStorage.getItem(ACTIVE_USER_STORAGE_KEY) || "").trim()
  } catch {
    return ""
  }
}

export function setActiveUserId(userId: string | null | undefined): void {
  if (typeof window === "undefined") return
  const next = String(userId || "").trim()
  try {
    if (!next) {
      localStorage.removeItem(ACTIVE_USER_STORAGE_KEY)
      return
    }
    localStorage.setItem(ACTIVE_USER_STORAGE_KEY, next)
  } catch {
    // no-op
  }
}

