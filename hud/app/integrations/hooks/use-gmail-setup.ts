import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { GMAIL_DEFAULT_REDIRECT_URI } from "../constants"
import { normalizeGmailAccountsForUi } from "./gmail-utils"
import { saveIntegrationsSettings, type IntegrationsSettings } from "@/lib/integrations/client-store"
import type { IntegrationsSaveStatus, IntegrationsSaveTarget } from "./use-llm-provider-setup"

interface UseGmailSetupParams {
  settings: IntegrationsSettings
  setSettings: Dispatch<SetStateAction<IntegrationsSettings>>
  setSaveStatus: Dispatch<SetStateAction<IntegrationsSaveStatus>>
  setIsSavingTarget: Dispatch<SetStateAction<IntegrationsSaveTarget>>
  onRequireLogin: () => void
}

export function useGmailSetup({
  settings,
  setSettings,
  setSaveStatus,
  setIsSavingTarget,
  onRequireLogin,
}: UseGmailSetupParams) {
  const [gmailClientId, setGmailClientId] = useState("")
  const [gmailClientSecret, setGmailClientSecret] = useState("")
  const [gmailClientSecretConfigured, setGmailClientSecretConfigured] = useState(false)
  const [gmailClientSecretMasked, setGmailClientSecretMasked] = useState("")
  const [gmailRedirectUri, setGmailRedirectUri] = useState(GMAIL_DEFAULT_REDIRECT_URI)
  const [selectedGmailAccountId, setSelectedGmailAccountId] = useState("")
  const gmailPopupRef = useRef<Window | null>(null)
  const gmailPopupWatchRef = useRef<number | null>(null)

  const hydrate = useCallback((nextSettings: IntegrationsSettings) => {
    setGmailClientId(nextSettings.gmail.oauthClientId || "")
    setGmailClientSecret(nextSettings.gmail.oauthClientSecret || "")
    setGmailClientSecretConfigured(Boolean(nextSettings.gmail.oauthClientSecretConfigured))
    setGmailClientSecretMasked(nextSettings.gmail.oauthClientSecretMasked || "")
    setGmailRedirectUri(nextSettings.gmail.redirectUri || GMAIL_DEFAULT_REDIRECT_URI)
  }, [])

  useEffect(() => {
    const accounts = settings.gmail.accounts || []
    if (accounts.length === 0) {
      if (selectedGmailAccountId) setSelectedGmailAccountId("")
      return
    }
    const hasSelected = accounts.some((account) => account.id === selectedGmailAccountId)
    if (hasSelected) return
    const preferred = accounts.find((account) => account.active) || accounts[0]
    if (preferred) setSelectedGmailAccountId(preferred.id)
  }, [selectedGmailAccountId, settings.gmail.accounts])

  const refreshFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/config", { cache: "no-store", credentials: "include" })
      const data = await res.json().catch(() => ({}))
      const config = data?.config as IntegrationsSettings | undefined
      if (!config) return
      setSettings((prev) => {
        const next = {
          ...prev,
          gmail: {
            ...prev.gmail,
            connected: Boolean(config.gmail?.connected),
            email: String(config.gmail?.email || ""),
            scopes: Array.isArray(config.gmail?.scopes)
              ? config.gmail.scopes.join(" ")
              : typeof config.gmail?.scopes === "string"
                ? config.gmail.scopes
                : "",
            accounts: normalizeGmailAccountsForUi(config.gmail?.accounts, String(config.gmail?.activeAccountId || "")),
            activeAccountId: String(config.gmail?.activeAccountId || ""),
            tokenConfigured: Boolean(config.gmail?.tokenConfigured),
          },
        }
        saveIntegrationsSettings(next)
        return next
      })
    } catch {
      // no-op
    }
  }, [setSettings])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const gmailStatus = params.get("gmail")
    const message = params.get("message")
    const gmailPopup = params.get("gmailPopup") === "1"
    if (!gmailStatus) return

    if (gmailPopup && window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "nova:gmail-oauth", status: gmailStatus, message: message || "" },
        window.location.origin,
      )
      window.close()
      return
    }

    if (gmailStatus === "success") {
      setSaveStatus({ type: "success", message: message || "Gmail connected." })
      void refreshFromServer()
    } else {
      setSaveStatus({ type: "error", message: message || "Gmail connection failed." })
    }

    params.delete("gmail")
    params.delete("message")
    const next = params.toString()
    const newUrl = `${window.location.pathname}${next ? `?${next}` : ""}`
    window.history.replaceState({}, "", newUrl)
  }, [refreshFromServer, setSaveStatus])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const payload = event.data as { type?: string; status?: string; message?: string } | null
      if (!payload || payload.type !== "nova:gmail-oauth") return
      if (gmailPopupRef.current && !gmailPopupRef.current.closed) {
        try {
          gmailPopupRef.current.close()
        } catch {
          // no-op
        }
      }
      gmailPopupRef.current = null
      if (gmailPopupWatchRef.current !== null) {
        window.clearInterval(gmailPopupWatchRef.current)
        gmailPopupWatchRef.current = null
      }
      if (payload.status === "success") {
        setSaveStatus({ type: "success", message: payload.message || "Gmail connected." })
        void refreshFromServer()
      } else {
        setSaveStatus({ type: "error", message: payload.message || "Gmail connection failed." })
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [refreshFromServer, setSaveStatus])

  useEffect(() => {
    return () => {
      if (gmailPopupWatchRef.current !== null) {
        window.clearInterval(gmailPopupWatchRef.current)
      }
      gmailPopupWatchRef.current = null
      gmailPopupRef.current = null
    }
  }, [])

  const connectGmail = useCallback(() => {
    if (!gmailClientId.trim() || (!gmailClientSecretConfigured && !gmailClientSecret.trim())) {
      setSaveStatus({ type: "error", message: "Save Gmail OAuth Client ID and Client Secret first." })
      return
    }
    setSaveStatus(null)
    const returnTo = "/integrations?gmailPopup=1"
    const fetchUrl = `/api/integrations/gmail/connect?mode=json&returnTo=${encodeURIComponent(returnTo)}`
    void fetch(fetchUrl, { cache: "no-store", credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.authUrl) {
          if (res.status === 401) {
            onRequireLogin()
            throw new Error("Session expired. Please sign in again.")
          }
          throw new Error(data?.error || "Failed to start Gmail OAuth.")
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
          "nova-gmail-oauth",
          `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
        )
        if (!popup) {
          gmailPopupRef.current = null
          if (gmailPopupWatchRef.current !== null) {
            window.clearInterval(gmailPopupWatchRef.current)
            gmailPopupWatchRef.current = null
          }
          const tab = window.open(target, "_blank")
          if (!tab) {
            setSaveStatus({
              type: "error",
              message: "Popup was blocked. Allow popups for Nova to connect Gmail without leaving this screen.",
            })
          } else {
            setSaveStatus({
              type: "success",
              message: "Opened Gmail auth in a new tab/window. Nova will stay open here.",
            })
          }
        } else {
          gmailPopupRef.current = popup
          if (gmailPopupWatchRef.current !== null) {
            window.clearInterval(gmailPopupWatchRef.current)
          }
          gmailPopupWatchRef.current = window.setInterval(() => {
            const handle = gmailPopupRef.current
            if (!handle || handle.closed) {
              if (gmailPopupWatchRef.current !== null) {
                window.clearInterval(gmailPopupWatchRef.current)
                gmailPopupWatchRef.current = null
              }
              gmailPopupRef.current = null
            }
          }, 500)
        }
      })
      .catch((error) => {
        setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to start Gmail OAuth." })
      })
  }, [gmailClientId, gmailClientSecret, gmailClientSecretConfigured, onRequireLogin, setSaveStatus])

  const saveGmailConfig = useCallback(async () => {
    const payload: Record<string, unknown> = {
      oauthClientId: gmailClientId.trim(),
      redirectUri: gmailRedirectUri.trim() || GMAIL_DEFAULT_REDIRECT_URI,
    }
    const trimmedSecret = gmailClientSecret.trim()
    if (trimmedSecret) payload.oauthClientSecret = trimmedSecret

    if (!payload.oauthClientId || (!gmailClientSecretConfigured && !trimmedSecret)) {
      setSaveStatus({ type: "error", message: "Gmail Client ID and Client Secret are required." })
      return
    }

    setSaveStatus(null)
    setIsSavingTarget("gmail-oauth")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gmail: payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to save Gmail OAuth config.")

      const masked = typeof data?.config?.gmail?.oauthClientSecretMasked === "string" ? data.config.gmail.oauthClientSecretMasked : ""
      const configured = Boolean(data?.config?.gmail?.oauthClientSecretConfigured) || trimmedSecret.length > 0
      setGmailClientSecret("")
      setGmailClientSecretMasked(masked)
      setGmailClientSecretConfigured(configured)
      setSettings((prev) => {
        const next = {
          ...prev,
          gmail: {
            ...prev.gmail,
            oauthClientId: String(payload.oauthClientId || ""),
            redirectUri: String(payload.redirectUri || ""),
            oauthClientSecret: "",
            oauthClientSecretConfigured: configured,
            oauthClientSecretMasked: masked,
          },
        }
        saveIntegrationsSettings(next)
        return next
      })

      setSaveStatus({ type: "success", message: "Gmail OAuth configuration saved." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to save Gmail OAuth config." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [gmailClientId, gmailClientSecret, gmailClientSecretConfigured, gmailRedirectUri, setIsSavingTarget, setSaveStatus, setSettings])

  const disconnectGmail = useCallback(async (accountId?: string) => {
    setSaveStatus(null)
    setIsSavingTarget("gmail-disconnect")
    try {
      const res = await fetch("/api/integrations/gmail/disconnect", {
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
        throw new Error(data?.error || "Failed to disconnect Gmail.")
      }
      await refreshFromServer()
      setSaveStatus({ type: "success", message: accountId ? "Gmail account disconnected." : "All Gmail accounts disconnected." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to disconnect Gmail." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [onRequireLogin, refreshFromServer, setIsSavingTarget, setSaveStatus])

  const setPrimaryGmailAccount = useCallback(async (accountId: string) => {
    const nextId = String(accountId || "").trim().toLowerCase()
    if (!nextId) return
    setSaveStatus(null)
    setIsSavingTarget("gmail-primary")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gmail: { activeAccountId: nextId } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to set primary Gmail account.")
      await refreshFromServer()
      setSaveStatus({ type: "success", message: "Primary Gmail account updated." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to set primary Gmail account." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [refreshFromServer, setIsSavingTarget, setSaveStatus])

  const updateGmailAccountState = useCallback(async (action: "set_enabled" | "delete", accountId: string, enabled?: boolean) => {
    const targetId = String(accountId || "").trim().toLowerCase()
    if (!targetId) return
    setSaveStatus(null)
    setIsSavingTarget("gmail-account")
    try {
      const res = await fetch("/api/integrations/gmail/accounts", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "set_enabled"
            ? { action, accountId: targetId, enabled: Boolean(enabled) }
            : { action, accountId: targetId },
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          onRequireLogin()
          throw new Error("Session expired. Please sign in again.")
        }
        throw new Error(data?.error || "Failed to update Gmail account.")
      }
      await refreshFromServer()
      setSaveStatus({
        type: "success",
        message: action === "delete" ? "Gmail account removed." : (enabled ? "Gmail account enabled." : "Gmail account disabled."),
      })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to update Gmail account." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [onRequireLogin, refreshFromServer, setIsSavingTarget, setSaveStatus])

  return {
    gmailClientId,
    setGmailClientId,
    gmailClientSecret,
    setGmailClientSecret,
    gmailClientSecretConfigured,
    gmailClientSecretMasked,
    gmailRedirectUri,
    setGmailRedirectUri,
    selectedGmailAccountId,
    setSelectedGmailAccountId,
    hydrate,
    connectGmail,
    saveGmailConfig,
    disconnectGmail,
    setPrimaryGmailAccount,
    updateGmailAccountState,
  }
}
