const ACTIVE_USER_STORAGE_KEY = "nova_active_user_id"
export const ACTIVE_USER_CHANGED_EVENT = "nova:active-user-changed"

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
      const prev = String(localStorage.getItem(ACTIVE_USER_STORAGE_KEY) || "").trim()
      localStorage.removeItem(ACTIVE_USER_STORAGE_KEY)
      if (prev) {
        window.dispatchEvent(new CustomEvent(ACTIVE_USER_CHANGED_EVENT, { detail: { userId: "" } }))
      }
      return
    }
    const prev = String(localStorage.getItem(ACTIVE_USER_STORAGE_KEY) || "").trim()
    localStorage.setItem(ACTIVE_USER_STORAGE_KEY, next)
    if (prev !== next) {
      window.dispatchEvent(new CustomEvent(ACTIVE_USER_CHANGED_EVENT, { detail: { userId: next } }))
    }
  } catch {
    // no-op
  }
}
