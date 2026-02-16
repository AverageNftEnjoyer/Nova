import type { Conversation } from "@/lib/conversations"
import type { ThemeBackgroundType, OrbColor } from "@/lib/userSettings"
import { getActiveUserId } from "@/lib/active-user"

interface ShellUiCache {
  conversations: Conversation[] | null
  orbColor: OrbColor | null
  background: ThemeBackgroundType | null
  backgroundVideoUrl: string | null
  spotlightEnabled: boolean | null
}

const cache: ShellUiCache = {
  conversations: null,
  orbColor: null,
  background: null,
  backgroundVideoUrl: null,
  spotlightEnabled: null,
}
let cacheUserId: string | null = null

function ensureScopedCacheUser(): void {
  const currentUserId = getActiveUserId() || null
  if (cacheUserId === currentUserId) return
  cache.conversations = null
  cache.orbColor = null
  cache.background = null
  cache.backgroundVideoUrl = null
  cache.spotlightEnabled = null
  cacheUserId = currentUserId
}

export function readShellUiCache(): Readonly<ShellUiCache> {
  ensureScopedCacheUser()
  return cache
}

export function writeShellUiCache(next: Partial<ShellUiCache>): void {
  ensureScopedCacheUser()
  if (Object.prototype.hasOwnProperty.call(next, "conversations")) {
    cache.conversations = next.conversations ?? null
  }
  if (Object.prototype.hasOwnProperty.call(next, "orbColor")) {
    cache.orbColor = next.orbColor ?? null
  }
  if (Object.prototype.hasOwnProperty.call(next, "background")) {
    cache.background = next.background ?? null
  }
  if (Object.prototype.hasOwnProperty.call(next, "backgroundVideoUrl")) {
    cache.backgroundVideoUrl = next.backgroundVideoUrl ?? null
  }
  if (Object.prototype.hasOwnProperty.call(next, "spotlightEnabled")) {
    cache.spotlightEnabled = next.spotlightEnabled ?? null
  }
}
