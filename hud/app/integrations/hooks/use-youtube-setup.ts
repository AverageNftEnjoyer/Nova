import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"

import { saveIntegrationsSettings, type IntegrationsSettings } from "@/lib/integrations/store/client-store"
import type { IntegrationsSaveStatus, IntegrationsSaveTarget } from "./use-llm-provider-setup"

const YOUTUBE_DEFAULT_REDIRECT_URI = "http://localhost:3000/api/integrations/youtube/callback"

interface UseYouTubeSetupParams {
  setSettings: Dispatch<SetStateAction<IntegrationsSettings>>
  setSaveStatus: Dispatch<SetStateAction<IntegrationsSaveStatus>>
  setIsSavingTarget: Dispatch<SetStateAction<IntegrationsSaveTarget>>
  onRequireLogin: () => void
}

type YouTubePermissionPatch = Partial<IntegrationsSettings["youtube"]["permissions"]>

export function useYouTubeSetup({
  setSettings,
  setSaveStatus,
  setIsSavingTarget,
  onRequireLogin,
}: UseYouTubeSetupParams) {
  const [youtubeRedirectUri, setYouTubeRedirectUri] = useState(YOUTUBE_DEFAULT_REDIRECT_URI)
  const [youtubeChannelId, setYouTubeChannelId] = useState("")
  const [youtubeChannelTitle, setYouTubeChannelTitle] = useState("")
  const [youtubeScopes, setYouTubeScopes] = useState("")
  const [youtubePermissions, setYouTubePermissions] = useState({
    allowFeed: true,
    allowSearch: true,
    allowVideoDetails: true,
  })
  const youtubePopupRef = useRef<Window | null>(null)
  const youtubePopupWatchRef = useRef<number | null>(null)

  const hydrate = useCallback((nextSettings: IntegrationsSettings) => {
    setYouTubeRedirectUri(nextSettings.youtube.redirectUri || YOUTUBE_DEFAULT_REDIRECT_URI)
    setYouTubeChannelId(nextSettings.youtube.channelId || "")
    setYouTubeChannelTitle(nextSettings.youtube.channelTitle || "")
    setYouTubeScopes(nextSettings.youtube.scopes || "")
    setYouTubePermissions({
      allowFeed: typeof nextSettings.youtube.permissions?.allowFeed === "boolean" ? nextSettings.youtube.permissions.allowFeed : true,
      allowSearch: typeof nextSettings.youtube.permissions?.allowSearch === "boolean" ? nextSettings.youtube.permissions.allowSearch : true,
      allowVideoDetails: typeof nextSettings.youtube.permissions?.allowVideoDetails === "boolean" ? nextSettings.youtube.permissions.allowVideoDetails : true,
    })
  }, [])

  const refreshFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/config", { cache: "no-store", credentials: "include" })
      const data = await res.json().catch(() => ({}))
      const config = data?.config as IntegrationsSettings | undefined
      if (!config) return
      setSettings((prev) => {
        const next = {
          ...prev,
          news: {
            ...prev.news,
            preferredSources: Array.isArray(config.news?.preferredSources)
              ? config.news.preferredSources.map((value: unknown) => String(value).trim()).filter(Boolean).join(",")
              : typeof config.news?.preferredSources === "string"
                ? config.news.preferredSources
                : prev.news.preferredSources,
          },
          youtube: {
            ...prev.youtube,
            connected: Boolean(config.youtube?.connected),
            channelId: String(config.youtube?.channelId || ""),
            channelTitle: String(config.youtube?.channelTitle || ""),
            scopes: Array.isArray(config.youtube?.scopes)
              ? config.youtube.scopes.join(" ")
              : typeof config.youtube?.scopes === "string"
                ? config.youtube.scopes
                : "",
            permissions: {
              allowFeed:
                typeof config.youtube?.permissions?.allowFeed === "boolean"
                  ? config.youtube.permissions.allowFeed
                  : prev.youtube.permissions.allowFeed,
              allowSearch:
                typeof config.youtube?.permissions?.allowSearch === "boolean"
                  ? config.youtube.permissions.allowSearch
                  : prev.youtube.permissions.allowSearch,
              allowVideoDetails:
                typeof config.youtube?.permissions?.allowVideoDetails === "boolean"
                  ? config.youtube.permissions.allowVideoDetails
                  : prev.youtube.permissions.allowVideoDetails,
            },
            redirectUri: String(config.youtube?.redirectUri || YOUTUBE_DEFAULT_REDIRECT_URI),
            tokenConfigured: Boolean(config.youtube?.tokenConfigured),
          },
        }
        saveIntegrationsSettings(next)
        return next
      })
      setYouTubeRedirectUri(String(config.youtube?.redirectUri || YOUTUBE_DEFAULT_REDIRECT_URI))
      setYouTubeChannelId(String(config.youtube?.channelId || ""))
      setYouTubeChannelTitle(String(config.youtube?.channelTitle || ""))
      setYouTubeScopes(Array.isArray(config.youtube?.scopes) ? config.youtube.scopes.join(" ") : String(config.youtube?.scopes || ""))
      setYouTubePermissions({
        allowFeed: typeof config.youtube?.permissions?.allowFeed === "boolean" ? config.youtube.permissions.allowFeed : true,
        allowSearch: typeof config.youtube?.permissions?.allowSearch === "boolean" ? config.youtube.permissions.allowSearch : true,
        allowVideoDetails: typeof config.youtube?.permissions?.allowVideoDetails === "boolean" ? config.youtube.permissions.allowVideoDetails : true,
      })
    } catch {
      // no-op
    }
  }, [setSettings])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get("youtube")
    const message = params.get("message")
    const popupMode = params.get("youtubePopup") === "1"
    if (!status) return

    if (popupMode && window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "nova:youtube-oauth", status, message: message || "" },
        window.location.origin,
      )
      window.close()
      return
    }

    if (status === "success") {
      setSaveStatus({ type: "success", message: message || "YouTube connected." })
      void refreshFromServer()
    } else {
      setSaveStatus({ type: "error", message: message || "YouTube connection failed." })
    }

    params.delete("youtube")
    params.delete("message")
    const next = params.toString()
    const newUrl = `${window.location.pathname}${next ? `?${next}` : ""}`
    window.history.replaceState({}, "", newUrl)
  }, [refreshFromServer, setSaveStatus])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (youtubePopupRef.current && event.source !== youtubePopupRef.current) return
      const payload = event.data as { type?: string; status?: string; message?: string } | null
      if (!payload || payload.type !== "nova:youtube-oauth") return
      if (youtubePopupRef.current && !youtubePopupRef.current.closed) {
        try {
          youtubePopupRef.current.close()
        } catch {
          // no-op
        }
      }
      youtubePopupRef.current = null
      if (youtubePopupWatchRef.current !== null) {
        window.clearInterval(youtubePopupWatchRef.current)
        youtubePopupWatchRef.current = null
      }
      if (payload.status === "success") {
        setSaveStatus({ type: "success", message: payload.message || "YouTube connected." })
        void refreshFromServer()
      } else {
        setSaveStatus({ type: "error", message: payload.message || "YouTube connection failed." })
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [refreshFromServer, setSaveStatus])

  useEffect(() => {
    return () => {
      if (youtubePopupWatchRef.current !== null) {
        window.clearInterval(youtubePopupWatchRef.current)
      }
      youtubePopupWatchRef.current = null
      youtubePopupRef.current = null
    }
  }, [])

  const connectYouTube = useCallback(() => {
    setSaveStatus(null)
    const returnTo = "/integrations?youtubePopup=1"
    const fetchUrl = `/api/integrations/youtube/connect?mode=json&returnTo=${encodeURIComponent(returnTo)}`
    void fetch(fetchUrl, { cache: "no-store", credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.authUrl) {
          if (res.status === 401) {
            onRequireLogin()
            throw new Error("Session expired. Please sign in again.")
          }
          throw new Error(data?.error || "Failed to start YouTube OAuth.")
        }
        return String(data.authUrl)
      })
      .then((target) => {
        const width = 620
        const height = 760
        const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - width) / 2))
        const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - height) / 2))
        const popup = window.open(
          target,
          "nova-youtube-oauth",
          `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
        )
        if (!popup) {
          youtubePopupRef.current = null
          if (youtubePopupWatchRef.current !== null) {
            window.clearInterval(youtubePopupWatchRef.current)
            youtubePopupWatchRef.current = null
          }
          const tab = window.open(target, "_blank")
          if (!tab) {
            setSaveStatus({
              type: "error",
              message: "Popup was blocked. Allow popups for Nova to connect YouTube without leaving this screen.",
            })
          } else {
            setSaveStatus({
              type: "success",
              message: "Opened YouTube auth in a new tab/window. Nova will stay open here.",
            })
          }
        } else {
          youtubePopupRef.current = popup
          if (youtubePopupWatchRef.current !== null) {
            window.clearInterval(youtubePopupWatchRef.current)
          }
          const watchStart = Date.now()
          youtubePopupWatchRef.current = window.setInterval(() => {
            try {
              const handle = youtubePopupRef.current
              const closed = !handle || handle.closed
              const expired = Date.now() - watchStart > 5 * 60 * 1000
              if (closed || expired) {
                if (youtubePopupWatchRef.current !== null) {
                  window.clearInterval(youtubePopupWatchRef.current)
                  youtubePopupWatchRef.current = null
                }
                youtubePopupRef.current = null
              }
            } catch {
              if (youtubePopupWatchRef.current !== null) {
                window.clearInterval(youtubePopupWatchRef.current)
                youtubePopupWatchRef.current = null
              }
              youtubePopupRef.current = null
            }
          }, 500)
        }
      })
      .catch((error) => {
        setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to start YouTube OAuth." })
      })
  }, [onRequireLogin, setSaveStatus])

  const saveYouTubeConfig = useCallback(async () => {
    setSaveStatus(null)
    setIsSavingTarget("youtube-save")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtube: {
            redirectUri: youtubeRedirectUri.trim() || YOUTUBE_DEFAULT_REDIRECT_URI,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to save YouTube OAuth config.")
      await refreshFromServer()
      setSaveStatus({ type: "success", message: "YouTube OAuth configuration saved." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to save YouTube OAuth config." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [refreshFromServer, setIsSavingTarget, setSaveStatus, youtubeRedirectUri])

  const disconnectYouTube = useCallback(async () => {
    setSaveStatus(null)
    setIsSavingTarget("youtube-disconnect")
    try {
      const res = await fetch("/api/integrations/youtube/disconnect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          onRequireLogin()
          throw new Error("Session expired. Please sign in again.")
        }
        throw new Error(data?.error || "Failed to disconnect YouTube.")
      }
      await refreshFromServer()
      setSaveStatus({ type: "success", message: "YouTube disconnected." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to disconnect YouTube." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [onRequireLogin, refreshFromServer, setIsSavingTarget, setSaveStatus])

  const testYouTubeConnection = useCallback(async () => {
    setSaveStatus(null)
    setIsSavingTarget("youtube-test")
    try {
      const res = await fetch("/api/integrations/test-youtube", {
        method: "POST",
        credentials: "include",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          onRequireLogin()
          throw new Error("Session expired. Please sign in again.")
        }
        throw new Error(data?.error || "YouTube probe failed.")
      }
      await refreshFromServer()
      const summary = data?.channelTitle
        ? `YouTube connected as ${String(data.channelTitle)}.`
        : "YouTube connected."
      setSaveStatus({ type: "success", message: summary })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "YouTube probe failed." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [onRequireLogin, refreshFromServer, setIsSavingTarget, setSaveStatus])

  const updateYouTubePermissions = useCallback(async (patch: YouTubePermissionPatch) => {
    setSaveStatus(null)
    setIsSavingTarget("youtube-permissions")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtube: {
            permissions: patch,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 401) {
          onRequireLogin()
          throw new Error("Session expired. Please sign in again.")
        }
        throw new Error(data?.error || "Failed to update YouTube permissions.")
      }
      await refreshFromServer()
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update YouTube permissions.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [onRequireLogin, refreshFromServer, setIsSavingTarget, setSaveStatus])

  return {
    youtubeRedirectUri,
    setYouTubeRedirectUri,
    youtubeChannelId,
    youtubeChannelTitle,
    youtubeScopes,
    youtubePermissions,
    hydrate,
    connectYouTube,
    saveYouTubeConfig,
    disconnectYouTube,
    testYouTubeConnection,
    updateYouTubePermissions,
  }
}
