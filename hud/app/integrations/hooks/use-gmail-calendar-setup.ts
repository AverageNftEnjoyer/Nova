import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { saveIntegrationsSettings, type IntegrationsSettings } from "@/lib/integrations/client-store"
import type { IntegrationsSaveStatus, IntegrationsSaveTarget } from "./use-llm-provider-setup"

interface UseGmailCalendarSetupParams {
  settings: IntegrationsSettings
  setSettings: Dispatch<SetStateAction<IntegrationsSettings>>
  setSaveStatus: Dispatch<SetStateAction<IntegrationsSaveStatus>>
  setIsSavingTarget: Dispatch<SetStateAction<IntegrationsSaveTarget>>
  onRequireLogin: () => void
}

type CalendarPermissionPatch = Partial<IntegrationsSettings["gcalendar"]["permissions"]>

export function useGmailCalendarSetup({
  settings,
  setSettings,
  setSaveStatus,
  setIsSavingTarget,
  onRequireLogin,
}: UseGmailCalendarSetupParams) {
  const [selectedAccountId, setSelectedAccountId] = useState("")
  const popupRef = useRef<Window | null>(null)
  const popupWatchRef = useRef<number | null>(null)

  // Sync selectedAccountId when accounts change
  useEffect(() => {
    const accounts = settings.gcalendar.accounts ?? []
    if (accounts.length === 0) {
      if (selectedAccountId) setSelectedAccountId("")
      return
    }
    const hasSelected = accounts.some((a) => a.id === selectedAccountId)
    if (hasSelected) return
    const preferred = accounts.find((a) => a.active) || accounts[0]
    if (preferred) setSelectedAccountId(preferred.id)
  }, [selectedAccountId, settings.gcalendar.accounts])

  const refreshFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/config", { cache: "no-store", credentials: "include" })
      const data = await res.json().catch(() => ({}))
      const config = data?.config as IntegrationsSettings | undefined
      if (!config) return
      setSettings((prev) => {
        const next = {
          ...prev,
          gcalendar: {
            ...prev.gcalendar,
            connected: Boolean(config.gcalendar?.connected),
            email: String(config.gcalendar?.email || ""),
            scopes: Array.isArray(config.gcalendar?.scopes)
              ? config.gcalendar.scopes.join(" ")
              : typeof config.gcalendar?.scopes === "string"
                ? config.gcalendar.scopes
                : "",
            accounts: Array.isArray(config.gcalendar?.accounts)
              ? config.gcalendar.accounts.map((a) => ({
                  id: String(a?.id || ""),
                  email: String(a?.email || ""),
                  scopes: Array.isArray(a?.scopes) ? a.scopes : [],
                  connectedAt: a?.connectedAt || "",
                  active: a?.id === config.gcalendar?.activeAccountId,
                  enabled: a?.enabled ?? true,
                }))
              : [],
            activeAccountId: String(config.gcalendar?.activeAccountId || ""),
            tokenConfigured: Boolean(config.gcalendar?.tokenConfigured),
            permissions: {
              allowCreate: typeof config.gcalendar?.permissions?.allowCreate === "boolean"
                ? config.gcalendar.permissions.allowCreate
                : prev.gcalendar.permissions.allowCreate,
              allowEdit: typeof config.gcalendar?.permissions?.allowEdit === "boolean"
                ? config.gcalendar.permissions.allowEdit
                : prev.gcalendar.permissions.allowEdit,
              allowDelete: typeof config.gcalendar?.permissions?.allowDelete === "boolean"
                ? config.gcalendar.permissions.allowDelete
                : prev.gcalendar.permissions.allowDelete,
            },
          },
        }
        saveIntegrationsSettings(next)
        return next
      })
    } catch {
      // no-op
    }
  }, [setSettings])

  // Handle redirect-flow status params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get("gmailCalendar")
    const message = params.get("message")
    const isPopup = params.get("gmailCalendarPopup") === "1"
    if (!status) return

    if (isPopup && window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "nova:gmail-calendar-oauth", status, message: message || "" },
        window.location.origin,
      )
      window.close()
      return
    }

    if (status === "success") {
      setSaveStatus({ type: "success", message: message || "Google Calendar connected." })
      void refreshFromServer()
    } else {
      setSaveStatus({ type: "error", message: message || "Google Calendar connection failed." })
    }

    params.delete("gmailCalendar")
    params.delete("message")
    const next = params.toString()
    window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`)
  }, [refreshFromServer, setSaveStatus])

  // Handle popup postMessage
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const payload = event.data as { type?: string; status?: string; message?: string } | null
      if (!payload || payload.type !== "nova:gmail-calendar-oauth") return
      try { popupRef.current?.close() } catch { /* no-op */ }
      popupRef.current = null
      if (popupWatchRef.current !== null) {
        window.clearTimeout(popupWatchRef.current)
        popupWatchRef.current = null
      }
      if (payload.status === "success") {
        setSaveStatus({ type: "success", message: payload.message || "Google Calendar connected." })
        void refreshFromServer()
      } else {
        setSaveStatus({ type: "error", message: payload.message || "Google Calendar connection failed." })
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [refreshFromServer, setSaveStatus])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (popupWatchRef.current !== null) window.clearTimeout(popupWatchRef.current)
      popupWatchRef.current = null
      popupRef.current = null
    }
  }, [])

  const connectGmailCalendar = useCallback(() => {
    const gmailConnected = settings.gmail.connected
    const hasGmailCredentials =
      Boolean(settings.gmail.oauthClientId?.trim()) &&
      (Boolean(settings.gmail.oauthClientSecretConfigured) || Boolean(settings.gmail.oauthClientSecret?.trim()))

    if (!hasGmailCredentials) {
      setSaveStatus({
        type: "error",
        message: gmailConnected
          ? "Gmail OAuth credentials are missing. Save Gmail Client ID + Secret in Gmail Setup, then reconnect Google Calendar."
          : "Set up Gmail OAuth credentials first (Client ID + Secret), then connect Google Calendar.",
      })
      return
    }

    setSaveStatus(null)
    const returnTo = "/integrations?gmailCalendarPopup=1"
    const fetchUrl = `/api/integrations/gmail-calendar/connect?mode=json&returnTo=${encodeURIComponent(returnTo)}`
    void fetch(fetchUrl, { cache: "no-store", credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.authUrl) {
          if (res.status === 401) {
            onRequireLogin()
            throw new Error("Session expired. Please sign in again.")
          }
          throw new Error(data?.error || "Failed to start Google Calendar OAuth.")
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
          "nova-gmail-calendar-oauth",
          `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
        )
        if (!popup) {
          const tab = window.open(target, "_blank")
          if (!tab) {
            setSaveStatus({
              type: "error",
              message: "Popup was blocked. Allow popups for Nova to connect Google Calendar.",
            })
          } else {
            setSaveStatus({
              type: "success",
              message: "Opened Google Calendar auth in a new tab.",
            })
          }
        } else {
          popupRef.current = popup
          if (popupWatchRef.current !== null) window.clearTimeout(popupWatchRef.current)
          // Avoid polling popup.closed because COOP can produce repeated console warnings.
          // OAuth completion is handled via postMessage from callback; timeout is cleanup only.
          popupWatchRef.current = window.setTimeout(() => {
            popupRef.current = null
            if (popupWatchRef.current !== null) {
              window.clearTimeout(popupWatchRef.current)
              popupWatchRef.current = null
            }
          }, 5 * 60 * 1000)
        }
      })
      .catch((error) => {
        setSaveStatus({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to start Google Calendar OAuth.",
        })
      })
  }, [
    onRequireLogin,
    setSaveStatus,
    settings.gmail.connected,
    settings.gmail.oauthClientId,
    settings.gmail.oauthClientSecret,
    settings.gmail.oauthClientSecretConfigured,
  ])

  const disconnectGmailCalendar = useCallback(async (accountId?: string) => {
    setSaveStatus(null)
    setIsSavingTarget("gmail-calendar-disconnect")
    try {
      const res = await fetch("/api/integrations/gmail-calendar/disconnect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: accountId || "" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          onRequireLogin()
          throw new Error("Session expired. Please sign in again.")
        }
        throw new Error(data?.error || "Failed to disconnect Gmail Calendar.")
      }
      await refreshFromServer()
      setSaveStatus({
        type: "success",
          message: accountId ? "Google Calendar account disconnected." : "Google Calendar disconnected.",
      })
    } catch (error) {
      setSaveStatus({
        type: "error",
          message: error instanceof Error ? error.message : "Failed to disconnect Google Calendar.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [onRequireLogin, refreshFromServer, setIsSavingTarget, setSaveStatus])

  const updateCalendarPermissions = useCallback(async (patch: CalendarPermissionPatch) => {
    setSaveStatus(null)
    setIsSavingTarget("gmail-calendar-permissions")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gcalendar: {
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
        throw new Error(data?.error || "Failed to update calendar permissions.")
      }
      await refreshFromServer()
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update calendar permissions.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [onRequireLogin, refreshFromServer, setIsSavingTarget, setSaveStatus])

  return {
    selectedAccountId,
    setSelectedAccountId,
    connectGmailCalendar,
    disconnectGmailCalendar,
    updateCalendarPermissions,
    refreshFromServer,
  }
}

