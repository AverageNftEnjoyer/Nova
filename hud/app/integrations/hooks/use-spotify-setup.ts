import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"

import { saveIntegrationsSettings, type IntegrationsSettings } from "@/lib/integrations/store/client-store"
import { SPOTIFY_DEFAULT_REDIRECT_URI } from "../constants"
import type { IntegrationsSaveStatus, IntegrationsSaveTarget } from "./use-llm-provider-setup"

interface UseSpotifySetupParams {
  setSettings: Dispatch<SetStateAction<IntegrationsSettings>>
  setSaveStatus: Dispatch<SetStateAction<IntegrationsSaveStatus>>
  setIsSavingTarget: Dispatch<SetStateAction<IntegrationsSaveTarget>>
  onRequireLogin: () => void
}

export function useSpotifySetup({
  setSettings,
  setSaveStatus,
  setIsSavingTarget,
  onRequireLogin,
}: UseSpotifySetupParams) {
  const [spotifyClientId, setSpotifyClientId] = useState("")
  const [spotifyRedirectUri, setSpotifyRedirectUri] = useState(SPOTIFY_DEFAULT_REDIRECT_URI)
  const [spotifyUserId, setSpotifyUserId] = useState("")
  const [spotifyDisplayName, setSpotifyDisplayName] = useState("")
  const [spotifyScopes, setSpotifyScopes] = useState("")
  const spotifyPopupRef = useRef<Window | null>(null)
  const spotifyPopupWatchRef = useRef<number | null>(null)

  const hydrate = useCallback((nextSettings: IntegrationsSettings) => {
    setSpotifyClientId(nextSettings.spotify.oauthClientId || "")
    setSpotifyRedirectUri(nextSettings.spotify.redirectUri || SPOTIFY_DEFAULT_REDIRECT_URI)
    setSpotifyUserId(nextSettings.spotify.spotifyUserId || "")
    setSpotifyDisplayName(nextSettings.spotify.displayName || "")
    setSpotifyScopes(nextSettings.spotify.scopes || "")
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
          spotify: {
            ...prev.spotify,
            connected: Boolean(config.spotify?.connected),
            spotifyUserId: String(config.spotify?.spotifyUserId || ""),
            displayName: String(config.spotify?.displayName || ""),
            scopes: Array.isArray(config.spotify?.scopes)
              ? config.spotify.scopes.join(" ")
              : typeof config.spotify?.scopes === "string"
                ? config.spotify.scopes
                : "",
            oauthClientId: String(config.spotify?.oauthClientId || ""),
            redirectUri: String(config.spotify?.redirectUri || SPOTIFY_DEFAULT_REDIRECT_URI),
            tokenConfigured: Boolean(config.spotify?.tokenConfigured),
          },
        }
        saveIntegrationsSettings(next)
        return next
      })
      setSpotifyClientId(String(config.spotify?.oauthClientId || ""))
      setSpotifyRedirectUri(String(config.spotify?.redirectUri || SPOTIFY_DEFAULT_REDIRECT_URI))
      setSpotifyUserId(String(config.spotify?.spotifyUserId || ""))
      setSpotifyDisplayName(String(config.spotify?.displayName || ""))
      setSpotifyScopes(Array.isArray(config.spotify?.scopes) ? config.spotify.scopes.join(" ") : String(config.spotify?.scopes || ""))
    } catch {
      // no-op
    }
  }, [setSettings])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const spotifyStatus = params.get("spotify")
    const message = params.get("message")
    const spotifyPopup = params.get("spotifyPopup") === "1"
    if (!spotifyStatus) return

    if (spotifyPopup && window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "nova:spotify-oauth", status: spotifyStatus, message: message || "" },
        window.location.origin,
      )
      window.close()
      return
    }

    if (spotifyStatus === "success") {
      setSaveStatus({ type: "success", message: message || "Spotify connected." })
      void refreshFromServer()
    } else {
      setSaveStatus({ type: "error", message: message || "Spotify connection failed." })
    }

    params.delete("spotify")
    params.delete("message")
    const next = params.toString()
    const newUrl = `${window.location.pathname}${next ? `?${next}` : ""}`
    window.history.replaceState({}, "", newUrl)
  }, [refreshFromServer, setSaveStatus])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const payload = event.data as { type?: string; status?: string; message?: string } | null
      if (!payload || payload.type !== "nova:spotify-oauth") return
      if (spotifyPopupRef.current && !spotifyPopupRef.current.closed) {
        try {
          spotifyPopupRef.current.close()
        } catch {
          // no-op
        }
      }
      spotifyPopupRef.current = null
      if (spotifyPopupWatchRef.current !== null) {
        window.clearInterval(spotifyPopupWatchRef.current)
        spotifyPopupWatchRef.current = null
      }
      if (payload.status === "success") {
        setSaveStatus({ type: "success", message: payload.message || "Spotify connected." })
        void refreshFromServer()
      } else {
        setSaveStatus({ type: "error", message: payload.message || "Spotify connection failed." })
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [refreshFromServer, setSaveStatus])

  useEffect(() => {
    return () => {
      if (spotifyPopupWatchRef.current !== null) {
        window.clearInterval(spotifyPopupWatchRef.current)
      }
      spotifyPopupWatchRef.current = null
      spotifyPopupRef.current = null
    }
  }, [])

  const connectSpotify = useCallback(() => {
    if (!spotifyClientId.trim()) {
      setSaveStatus({ type: "error", message: "Save Spotify OAuth Client ID first." })
      return
    }
    setSaveStatus(null)
    const returnTo = "/integrations?spotifyPopup=1"
    const fetchUrl = `/api/integrations/spotify/connect?mode=json&returnTo=${encodeURIComponent(returnTo)}`
    void fetch(fetchUrl, { cache: "no-store", credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.authUrl) {
          if (res.status === 401) {
            onRequireLogin()
            throw new Error("Session expired. Please sign in again.")
          }
          throw new Error(data?.error || "Failed to start Spotify OAuth.")
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
          "nova-spotify-oauth",
          `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
        )
        if (!popup) {
          spotifyPopupRef.current = null
          if (spotifyPopupWatchRef.current !== null) {
            window.clearInterval(spotifyPopupWatchRef.current)
            spotifyPopupWatchRef.current = null
          }
          const tab = window.open(target, "_blank")
          if (!tab) {
            setSaveStatus({
              type: "error",
              message: "Popup was blocked. Allow popups for Nova to connect Spotify without leaving this screen.",
            })
          } else {
            setSaveStatus({
              type: "success",
              message: "Opened Spotify auth in a new tab/window. Nova will stay open here.",
            })
          }
        } else {
          spotifyPopupRef.current = popup
          if (spotifyPopupWatchRef.current !== null) {
            window.clearInterval(spotifyPopupWatchRef.current)
          }
          const watchStart = Date.now()
          spotifyPopupWatchRef.current = window.setInterval(() => {
            try {
              const handle = spotifyPopupRef.current
              const closed = !handle || handle.closed
              const expired = Date.now() - watchStart > 5 * 60 * 1000
              if (closed || expired) {
                if (spotifyPopupWatchRef.current !== null) {
                  window.clearInterval(spotifyPopupWatchRef.current)
                  spotifyPopupWatchRef.current = null
                }
                spotifyPopupRef.current = null
              }
            } catch {
              if (spotifyPopupWatchRef.current !== null) {
                window.clearInterval(spotifyPopupWatchRef.current)
                spotifyPopupWatchRef.current = null
              }
              spotifyPopupRef.current = null
            }
          }, 500)
        }
      })
      .catch((error) => {
        setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to start Spotify OAuth." })
      })
  }, [onRequireLogin, setSaveStatus, spotifyClientId])

  const saveSpotifyConfig = useCallback(async () => {
    if (!spotifyClientId.trim()) {
      setSaveStatus({ type: "error", message: "Spotify Client ID is required." })
      return
    }
    setSaveStatus(null)
    setIsSavingTarget("spotify-save")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spotify: {
            oauthClientId: spotifyClientId.trim(),
            redirectUri: spotifyRedirectUri.trim() || SPOTIFY_DEFAULT_REDIRECT_URI,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to save Spotify OAuth config.")
      await refreshFromServer()
      setSaveStatus({ type: "success", message: "Spotify OAuth configuration saved." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to save Spotify OAuth config." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [refreshFromServer, setIsSavingTarget, setSaveStatus, spotifyClientId, spotifyRedirectUri])

  const disconnectSpotify = useCallback(async () => {
    setSaveStatus(null)
    setIsSavingTarget("spotify-disconnect")
    try {
      const res = await fetch("/api/integrations/spotify/disconnect", {
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
        throw new Error(data?.error || "Failed to disconnect Spotify.")
      }
      await refreshFromServer()
      setSaveStatus({ type: "success", message: "Spotify disconnected." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to disconnect Spotify." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [onRequireLogin, refreshFromServer, setIsSavingTarget, setSaveStatus])

  const testSpotifyConnection = useCallback(async () => {
    setSaveStatus(null)
    setIsSavingTarget("spotify-test")
    try {
      const res = await fetch("/api/integrations/test-spotify", {
        method: "POST",
        credentials: "include",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Spotify probe failed.")
      }
      await refreshFromServer()
      const summary = data?.nowPlaying?.playing
        ? `Spotify connected. Now playing ${String(data.nowPlaying.trackName || "Unknown")} by ${String(data.nowPlaying.artistName || "Unknown")}.`
        : `Spotify connected. ${Number(data?.deviceCount || 0)} device(s) detected.`
      setSaveStatus({ type: "success", message: summary })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Spotify probe failed." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [refreshFromServer, setIsSavingTarget, setSaveStatus])

  return {
    spotifyClientId,
    setSpotifyClientId,
    spotifyRedirectUri,
    setSpotifyRedirectUri,
    spotifyUserId,
    spotifyDisplayName,
    spotifyScopes,
    hydrate,
    connectSpotify,
    saveSpotifyConfig,
    disconnectSpotify,
    testSpotifyConnection,
  }
}
