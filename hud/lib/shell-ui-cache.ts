import type { Conversation } from "@/lib/conversations"
import type { BackgroundType, OrbColor } from "@/lib/userSettings"

interface ShellUiCache {
  conversations: Conversation[] | null
  orbColor: OrbColor | null
  background: BackgroundType | null
  spotlightEnabled: boolean | null
}

const cache: ShellUiCache = {
  conversations: null,
  orbColor: null,
  background: null,
  spotlightEnabled: null,
}

export function readShellUiCache(): Readonly<ShellUiCache> {
  return cache
}

export function writeShellUiCache(next: Partial<ShellUiCache>): void {
  if (Object.prototype.hasOwnProperty.call(next, "conversations")) {
    cache.conversations = next.conversations ?? null
  }
  if (Object.prototype.hasOwnProperty.call(next, "orbColor")) {
    cache.orbColor = next.orbColor ?? null
  }
  if (Object.prototype.hasOwnProperty.call(next, "background")) {
    cache.background = next.background ?? null
  }
  if (Object.prototype.hasOwnProperty.call(next, "spotlightEnabled")) {
    cache.spotlightEnabled = next.spotlightEnabled ?? null
  }
}
