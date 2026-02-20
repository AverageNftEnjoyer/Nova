import { useEffect } from "react"
import { loadUserSettings, type ThemeBackgroundType } from "@/lib/settings/userSettings"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import {
  getCachedBackgroundVideoObjectUrl,
  isBackgroundAssetImage,
  loadBackgroundVideoObjectUrl,
} from "@/lib/media/backgroundVideoStorage"

/**
 * Loads and manages background video/image URL when custom video background is enabled.
 * Handles caching and async loading of video assets.
 */
export function useBackgroundVideo(
  isLight: boolean,
  background: ThemeBackgroundType,
  setBackgroundVideoUrl: (url: string | null) => void,
  setBackgroundMediaIsImage: (isImage: boolean) => void
) {
  useEffect(() => {
    let cancelled = false
    if (isLight || background !== "customVideo") return

    const uiCached = readShellUiCache().backgroundVideoUrl
    if (uiCached) {
      setBackgroundVideoUrl(uiCached)
    }

    const app = loadUserSettings().app
    setBackgroundMediaIsImage(
      isBackgroundAssetImage(app.customBackgroundVideoMimeType, app.customBackgroundVideoFileName)
    )

    const selectedAssetId = app.customBackgroundVideoAssetId
    const cached = getCachedBackgroundVideoObjectUrl(selectedAssetId || undefined)
    if (cached) {
      setBackgroundVideoUrl(cached)
      writeShellUiCache({ backgroundVideoUrl: cached })
    }

    void loadBackgroundVideoObjectUrl(selectedAssetId || undefined)
      .then((url) => {
        if (cancelled) return
        setBackgroundVideoUrl(url)
        writeShellUiCache({ backgroundVideoUrl: url })
      })
      .catch(() => {
        if (cancelled) return
        const fallback = readShellUiCache().backgroundVideoUrl
        if (!fallback) setBackgroundVideoUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [background, isLight, setBackgroundVideoUrl, setBackgroundMediaIsImage])
}
