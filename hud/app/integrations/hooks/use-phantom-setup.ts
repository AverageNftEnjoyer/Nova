import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"

import {
  getPhantomEthereumProvider,
  getPhantomSolanaProvider,
  PHANTOM_APP_URL,
  readObservedPhantomEvmState,
  resolvePhantomContextSupport,
} from "@/lib/integrations/phantom/browser"
import { maskPhantomWalletAddress, normalizePhantomIntegrationConfig, type PhantomUserSettings } from "@/lib/integrations/phantom/types"
import { saveIntegrationsSettings, type IntegrationsSettings } from "@/lib/integrations/store/client-store"
import type { IntegrationsSaveStatus, IntegrationsSaveTarget } from "./use-llm-provider-setup"

interface UsePhantomSetupParams {
  setSettings: Dispatch<SetStateAction<IntegrationsSettings>>
  setSaveStatus: Dispatch<SetStateAction<IntegrationsSaveStatus>>
  setIsSavingTarget: Dispatch<SetStateAction<IntegrationsSaveTarget>>
  onRequireLogin: () => void
}

function getWalletAddress(value: unknown): string {
  if (!value) return ""
  if (typeof value === "string") return value.trim()
  if (typeof value === "object" && value && typeof (value as { toString?: () => string }).toString === "function") {
    return String((value as { toString: () => string }).toString() || "").trim()
  }
  return ""
}

function encodeBytesToBase64(input: Uint8Array): string {
  let binary = ""
  for (const byte of input) binary += String.fromCharCode(byte)
  return window.btoa(binary)
}

function toUint8Array(input: Uint8Array | ArrayBuffer | number[] | null | undefined): Uint8Array {
  if (!input) return new Uint8Array()
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (Array.isArray(input)) return Uint8Array.from(input)
  return new Uint8Array()
}

function resolveProviderErrorMessage(error: unknown, stage: "connect" | "sign"): string {
  const code = typeof (error as { code?: unknown })?.code === "number" ? Number((error as { code: number }).code) : null
  const message = error instanceof Error ? error.message : String(error || "")
  const normalized = message.trim().toLowerCase()
  if (code === 4001 || normalized.includes("user rejected")) {
    return stage === "connect" ? "Phantom connection was canceled." : "Phantom signature request was canceled."
  }
  if (normalized.includes("locked")) {
    return "Unlock Phantom and retry."
  }
  if (normalized.includes("not connected")) {
    return "Connect Phantom before retrying."
  }
  return stage === "connect" ? "Failed to connect Phantom." : "Failed to sign with Phantom."
}

function openPopupOrTab(target: string, name: string): boolean {
  const width = 1320
  const height = 900
  const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - width) / 2))
  const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - height) / 2))
  const popup = window.open(
    target,
    name,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
  )
  if (popup) return true
  const tab = window.open(target, "_blank")
  return Boolean(tab)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function usePhantomSetup({
  setSettings,
  setSaveStatus,
  setIsSavingTarget,
  onRequireLogin,
}: UsePhantomSetupParams) {
  const [walletAddress, setWalletAddress] = useState("")
  const [walletLabel, setWalletLabel] = useState("")
  const [connectedAt, setConnectedAt] = useState("")
  const [verifiedAt, setVerifiedAt] = useState("")
  const [lastDisconnectedAt, setLastDisconnectedAt] = useState("")
  const [evmAddress, setEvmAddress] = useState("")
  const [evmLabel, setEvmLabel] = useState("")
  const [evmChainId, setEvmChainId] = useState("")
  const [evmConnectedAt, setEvmConnectedAt] = useState("")
  const [evmAvailable, setEvmAvailable] = useState(false)
  const [providerInstalled, setProviderInstalled] = useState(false)
  const [providerReady, setProviderReady] = useState(false)
  const [providerSupportedContext, setProviderSupportedContext] = useState(true)
  const [providerContextReason, setProviderContextReason] = useState("")
  const [trustedReconnectReady, setTrustedReconnectReady] = useState(false)
  const invalidateInFlightRef = useRef(false)
  const suppressProviderDisconnectRef = useRef(false)
  const connectedWalletRef = useRef("")

  const applyNormalizedPhantom = useCallback((phantom: IntegrationsSettings["phantom"]) => {
    setWalletAddress(phantom.walletAddress)
    setWalletLabel(phantom.walletLabel)
    setConnectedAt(phantom.connectedAt)
    setVerifiedAt(phantom.verifiedAt)
    setLastDisconnectedAt(phantom.lastDisconnectedAt)
    setEvmAddress(phantom.evmAddress)
    setEvmLabel(phantom.evmLabel)
    setEvmChainId(phantom.evmChainId)
    setEvmConnectedAt(phantom.evmConnectedAt)
    setEvmAvailable(phantom.capabilities.evmAvailable === true || phantom.evmAddress.length > 0)
    connectedWalletRef.current = phantom.walletAddress
  }, [])

  const applyServerConfig = useCallback((config: IntegrationsSettings) => {
    const phantom = normalizePhantomIntegrationConfig(config.phantom)
    setSettings((prev) => {
      const next = {
        ...prev,
        phantom,
      }
      saveIntegrationsSettings(next)
      return next
    })
    applyNormalizedPhantom(phantom)
    return phantom
  }, [applyNormalizedPhantom, setSettings])

  const waitForInjectedProviders = useCallback(async (timeoutMs = 2500) => {
    if (typeof window === "undefined") {
      return {
        solanaProvider: null,
        ethereumProvider: null,
      }
    }
    const deadline = Date.now() + Math.max(250, timeoutMs)
    let solanaProvider = getPhantomSolanaProvider(window)
    let ethereumProvider = getPhantomEthereumProvider(window)
    while (!solanaProvider && !ethereumProvider && Date.now() < deadline) {
      await delay(150)
      solanaProvider = getPhantomSolanaProvider(window)
      ethereumProvider = getPhantomEthereumProvider(window)
    }
    return {
      solanaProvider,
      ethereumProvider,
    }
  }, [])

  const refreshObservedProviderState = useCallback(async (options?: { waitForInjection?: boolean }) => {
    if (typeof window === "undefined") return { evmAddress: "", evmChainId: "", evmAvailable: false }
    const contextSupport = resolvePhantomContextSupport(window)
    setProviderSupportedContext(contextSupport.supported)
    setProviderContextReason(contextSupport.reason)
    if (!contextSupport.supported) {
      setProviderInstalled(false)
      setProviderReady(false)
      setTrustedReconnectReady(false)
      setEvmAvailable(false)
      setEvmAddress("")
      setEvmLabel("")
      setEvmChainId("")
      return { evmAddress: "", evmChainId: "", evmAvailable: false }
    }

    const providerState = options?.waitForInjection ? await waitForInjectedProviders() : {
      solanaProvider: getPhantomSolanaProvider(window),
      ethereumProvider: getPhantomEthereumProvider(window),
    }
    const { solanaProvider, ethereumProvider } = providerState
    setProviderInstalled(Boolean(solanaProvider || ethereumProvider))
    setProviderReady(Boolean(solanaProvider?.publicKey))

    const observedEvm = await readObservedPhantomEvmState(ethereumProvider)
    setEvmAvailable(observedEvm.evmAvailable)
    setEvmAddress(observedEvm.evmAddress)
    setEvmLabel(observedEvm.evmAddress ? maskPhantomWalletAddress(observedEvm.evmAddress) : "")
    setEvmChainId(observedEvm.evmChainId)
    if (!observedEvm.evmAddress) setEvmConnectedAt("")
    return observedEvm
  }, [waitForInjectedProviders])

  const hydrate = useCallback((nextSettings: IntegrationsSettings) => {
    const phantom = normalizePhantomIntegrationConfig(nextSettings.phantom)
    applyNormalizedPhantom(phantom)
    void refreshObservedProviderState()
  }, [applyNormalizedPhantom, refreshObservedProviderState])

  const refreshFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/config", { cache: "no-store", credentials: "include" })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        onRequireLogin()
        return
      }
      const config = data?.config as IntegrationsSettings | undefined
      if (!config) return
      applyServerConfig(config)
      await refreshObservedProviderState()
    } catch {
      // no-op
    }
  }, [applyServerConfig, onRequireLogin, refreshObservedProviderState])

  const openExternalBrowser = useCallback(async (
    target: "connect" | "install",
    fallbackUrl: string,
    windowName: string,
    messages: { success: string; fallback: string; failure: string },
  ) => {
    if (typeof window === "undefined") return false
    try {
      const res = await fetch("/api/integrations/phantom/open-browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ target }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        onRequireLogin()
        throw new Error("Session expired. Please sign in again.")
      }
      if (!res.ok) {
        throw new Error(String(data?.error || messages.failure))
      }
      setSaveStatus({ type: "success", message: messages.success })
      return true
    } catch {
      const opened = openPopupOrTab(fallbackUrl, windowName)
      setSaveStatus({
        type: opened ? "success" : "error",
        message: opened ? messages.fallback : messages.failure,
      })
      return opened
    }
  }, [onRequireLogin, setSaveStatus])

  const openBrowserConnect = useCallback(async () => {
    if (typeof window === "undefined") return false
    const target = new URL("/integrations", window.location.origin)
    target.hash = "phantom"
    return openExternalBrowser(
      "connect",
      target.toString(),
      "nova-phantom-browser-connect",
      {
        success: "Opened Nova in your external browser. Finish Phantom connect there.",
        fallback: "Opened Nova in a browser window. Finish Phantom connect there.",
        failure: "Allow popups or open Nova in a standard browser window to connect Phantom.",
      },
    )
  }, [openExternalBrowser])

  const openPhantomInstall = useCallback(async () => {
    if (typeof window === "undefined") return false
    return openExternalBrowser(
      "install",
      PHANTOM_APP_URL,
      "nova-phantom-install",
      {
        success: "Opened Phantom in your external browser. Install or unlock the extension there, then retry.",
        fallback: "Opened Phantom in a new tab/window. Install or unlock the extension there, then retry.",
        failure: "Allow popups or open https://phantom.app/ in your browser to install Phantom.",
      },
    )
  }, [openExternalBrowser])

  const savePhantomPreferences = useCallback(async (patch: Partial<PhantomUserSettings>) => {
    setSaveStatus(null)
    setIsSavingTarget("phantom-settings")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phantom: {
            preferences: patch,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        onRequireLogin()
        throw new Error("Session expired. Please sign in again.")
      }
      if (!res.ok) {
        throw new Error(String(data?.error || "Failed to save Phantom settings."))
      }
      const config = data?.config as IntegrationsSettings | undefined
      if (config) {
        applyServerConfig(config)
      }
      setSaveStatus({ type: "success", message: "Phantom settings saved." })
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to save Phantom settings.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [applyServerConfig, onRequireLogin, setIsSavingTarget, setSaveStatus])

  const refreshProviderState = useCallback(async () => {
    const observed = await refreshObservedProviderState({ waitForInjection: true })
    if (typeof window === "undefined") return
    const detectedSolana = Boolean(getPhantomSolanaProvider(window))
    const detectedEvm = Boolean(getPhantomEthereumProvider(window))
    setSaveStatus({
      type: detectedSolana || detectedEvm ? "success" : "error",
      message:
        detectedSolana || detectedEvm
          ? "Phantom detected in this browser. You can retry Connect now."
          : "Phantom still is not detected. In Chrome, allow Phantom on localhost/all sites, then refocus this tab and retry.",
    })
    if (!observed.evmAddress) {
      setEvmAvailable(false)
    }
  }, [refreshObservedProviderState, setSaveStatus])

  const disconnectPhantom = useCallback(async (reason: "user_disconnect" | "wallet_changed" | "session_revoked" | "verification_reset" = "user_disconnect") => {
    setSaveStatus(null)
    setIsSavingTarget("phantom-disconnect")
    try {
      const provider = typeof window === "undefined" ? null : getPhantomSolanaProvider(window)
      if (provider) {
        suppressProviderDisconnectRef.current = true
        await provider.disconnect().catch(() => undefined)
      }
      const res = await fetch("/api/integrations/phantom/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        onRequireLogin()
        throw new Error("Session expired. Please sign in again.")
      }
      if (!res.ok) {
        throw new Error(String(data?.error || "Failed to disconnect Phantom."))
      }
      await refreshFromServer()
      setSaveStatus({
        type: reason === "wallet_changed" ? "error" : "disabled",
        message:
          reason === "wallet_changed"
            ? "Phantom account changed. Reconnect to verify the new wallet."
            : "Phantom disconnected.",
      })
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to disconnect Phantom.",
      })
    } finally {
      suppressProviderDisconnectRef.current = false
      setIsSavingTarget(null)
    }
  }, [onRequireLogin, refreshFromServer, setIsSavingTarget, setSaveStatus])

  useEffect(() => {
    let cancelled = false

    async function eagerReconnect() {
      const contextSupport = resolvePhantomContextSupport(typeof window === "undefined" ? null : window)
      setProviderSupportedContext(contextSupport.supported)
      setProviderContextReason(contextSupport.reason)
      if (!contextSupport.supported) {
        setProviderInstalled(false)
        setProviderReady(false)
        setTrustedReconnectReady(false)
        return
      }
      const provider = typeof window === "undefined" ? null : getPhantomSolanaProvider(window)
      const ethereumProvider = typeof window === "undefined" ? null : getPhantomEthereumProvider(window)
      setProviderInstalled(Boolean(provider || ethereumProvider))
      setProviderReady(Boolean(provider?.publicKey))
      if (!provider) {
        if (ethereumProvider) {
          const observed = await readObservedPhantomEvmState(ethereumProvider)
          if (!cancelled) {
            setEvmAvailable(observed.evmAvailable)
            setEvmAddress(observed.evmAddress)
            setEvmLabel(observed.evmAddress ? maskPhantomWalletAddress(observed.evmAddress) : "")
            setEvmChainId(observed.evmChainId)
          }
        }
        return
      }

      try {
        const trusted = await provider.connect({ onlyIfTrusted: true })
        if (cancelled) return
        const trustedWalletAddress = getWalletAddress(trusted.publicKey || provider.publicKey)
        setProviderReady(Boolean(trustedWalletAddress))
        setTrustedReconnectReady(Boolean(trustedWalletAddress))
        if (connectedWalletRef.current && trustedWalletAddress && trustedWalletAddress !== connectedWalletRef.current && !invalidateInFlightRef.current) {
          invalidateInFlightRef.current = true
          try {
            await disconnectPhantom("wallet_changed")
          } finally {
            invalidateInFlightRef.current = false
          }
          return
        }
      } catch {
        if (!cancelled) {
          setTrustedReconnectReady(false)
          setProviderReady(Boolean(provider.publicKey))
        }
      }

      const observed = await readObservedPhantomEvmState(ethereumProvider)
      if (!cancelled) {
        setEvmAvailable(observed.evmAvailable)
        setEvmAddress(observed.evmAddress)
        setEvmLabel(observed.evmAddress ? maskPhantomWalletAddress(observed.evmAddress) : "")
        setEvmChainId(observed.evmChainId)
      }
    }

    void eagerReconnect()
    return () => {
      cancelled = true
    }
  }, [disconnectPhantom])

  useEffect(() => {
    const provider = typeof window === "undefined" ? null : getPhantomSolanaProvider(window)
    const ethereumProvider = typeof window === "undefined" ? null : getPhantomEthereumProvider(window)
    if (!provider && !ethereumProvider) return

    const syncProviderState = async () => {
      const observed = await refreshObservedProviderState()
      if (observed.evmAddress) {
        setEvmConnectedAt((current) => current || new Date().toISOString())
      }
    }

    const handleAccountChanged = async (nextPublicKey?: unknown) => {
      await syncProviderState()
      const nextAddress = getWalletAddress(nextPublicKey || provider?.publicKey)
      const currentAddress = connectedWalletRef.current
      if (!currentAddress || invalidateInFlightRef.current) {
        return
      }
      if (nextAddress && nextAddress === currentAddress) {
        return
      }
      invalidateInFlightRef.current = true
      try {
        await disconnectPhantom("wallet_changed")
      } finally {
        invalidateInFlightRef.current = false
      }
    }

    const handleDisconnect = async () => {
      await syncProviderState()
      if (suppressProviderDisconnectRef.current) return
      if (!connectedWalletRef.current || invalidateInFlightRef.current) return
      invalidateInFlightRef.current = true
      try {
        await disconnectPhantom("wallet_changed")
      } finally {
        invalidateInFlightRef.current = false
      }
    }

    const handleEvmAccountsChanged = async (accounts?: unknown) => {
      const nextAddress = Array.isArray(accounts) ? getWalletAddress(accounts[0]) : ""
      setEvmAvailable(true)
      setEvmAddress(nextAddress)
      setEvmLabel(nextAddress ? maskPhantomWalletAddress(nextAddress) : "")
      if (!nextAddress) {
        setEvmConnectedAt("")
      } else {
        setEvmConnectedAt((current) => current || new Date().toISOString())
      }
    }

    const handleEvmChainChanged = (nextChainId?: unknown) => {
      setEvmChainId(String(nextChainId || "").trim().slice(0, 64))
    }

    const handleSolanaConnect = () => void syncProviderState()
    const handleEvmDisconnect = () => void syncProviderState()

    provider?.on?.("connect", handleSolanaConnect)
    provider?.on?.("accountChanged", handleAccountChanged)
    provider?.on?.("disconnect", handleDisconnect)
    ethereumProvider?.on?.("accountsChanged", handleEvmAccountsChanged)
    ethereumProvider?.on?.("chainChanged", handleEvmChainChanged)
    ethereumProvider?.on?.("disconnect", handleEvmDisconnect)
    return () => {
      provider?.off?.("connect", handleSolanaConnect)
      provider?.off?.("accountChanged", handleAccountChanged)
      provider?.off?.("disconnect", handleDisconnect)
      provider?.removeListener?.("connect", handleSolanaConnect)
      provider?.removeListener?.("accountChanged", handleAccountChanged)
      provider?.removeListener?.("disconnect", handleDisconnect)
      ethereumProvider?.off?.("accountsChanged", handleEvmAccountsChanged)
      ethereumProvider?.off?.("chainChanged", handleEvmChainChanged)
      ethereumProvider?.off?.("disconnect", handleEvmDisconnect)
      ethereumProvider?.removeListener?.("accountsChanged", handleEvmAccountsChanged)
      ethereumProvider?.removeListener?.("chainChanged", handleEvmChainChanged)
      ethereumProvider?.removeListener?.("disconnect", handleEvmDisconnect)
    }
  }, [disconnectPhantom, refreshObservedProviderState])

  useEffect(() => {
    if (typeof window === "undefined") return
    const handleFocus = () => void refreshObservedProviderState({ waitForInjection: true })
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshObservedProviderState({ waitForInjection: true })
      }
    }
    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [refreshObservedProviderState])

  const connectPhantom = useCallback(async () => {
    const contextSupport = resolvePhantomContextSupport(typeof window === "undefined" ? null : window)
    if (!contextSupport.supported) {
      setProviderSupportedContext(false)
      setProviderContextReason(contextSupport.reason)
      void openBrowserConnect()
      return
    }
    await refreshObservedProviderState({ waitForInjection: true })
    const provider = typeof window === "undefined" ? null : getPhantomSolanaProvider(window)
    if (!provider) {
      setProviderInstalled(Boolean(typeof window !== "undefined" && getPhantomEthereumProvider(window)))
      setSaveStatus({
        type: "error",
        message: "Phantom was not detected in this browser. In Chrome, allow Phantom on localhost/all sites, then click Refresh Detection and retry.",
      })
      return
    }

    setSaveStatus(null)
    setIsSavingTarget("phantom-connect")
    try {
      let connectResult
      try {
        connectResult = await provider.connect()
      } catch (error) {
        throw new Error(resolveProviderErrorMessage(error, "connect"))
      }
      const nextWalletAddress = getWalletAddress(connectResult.publicKey || provider.publicKey)
      if (!nextWalletAddress) {
        throw new Error("Unlock Phantom and retry.")
      }
      setProviderInstalled(true)
      setProviderReady(true)

      const observedEvm = await readObservedPhantomEvmState(typeof window === "undefined" ? null : getPhantomEthereumProvider(window))

      const challengeRes = await fetch("/api/integrations/phantom/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          walletAddress: nextWalletAddress,
          origin: window.location.href,
        }),
      })
      const challengeData = await challengeRes.json().catch(() => ({}))
      if (challengeRes.status === 401) {
        onRequireLogin()
        throw new Error("Session expired. Please sign in again.")
      }
      if (!challengeRes.ok) {
        throw new Error(String(challengeData?.error || "Failed to start Phantom verification."))
      }
      const message = String(challengeData?.challenge?.message || "")
      if (!message) {
        throw new Error("Phantom verification challenge was empty.")
      }

      const encodedMessage = new TextEncoder().encode(message)
      let signature: Uint8Array
      try {
        const signed = await provider.signMessage(encodedMessage, "utf8")
        signature = toUint8Array(signed.signature)
      } catch (error) {
        throw new Error(resolveProviderErrorMessage(error, "sign"))
      }
      if (signature.length === 0) {
        throw new Error("Phantom did not return a signature.")
      }

      const verifyRes = await fetch("/api/integrations/phantom/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          walletAddress: nextWalletAddress,
          signatureBase64: encodeBytesToBase64(signature),
          evmAddress: observedEvm.evmAddress,
          evmChainId: observedEvm.evmChainId,
        }),
      })
      const verifyData = await verifyRes.json().catch(() => ({}))
      if (verifyRes.status === 401) {
        onRequireLogin()
        throw new Error("Session expired. Please sign in again.")
      }
      if (!verifyRes.ok) {
        throw new Error(String(verifyData?.error || "Failed to verify Phantom wallet ownership."))
      }

      await refreshFromServer()
      setTrustedReconnectReady(true)
      setSaveStatus({
        type: "success",
        message: observedEvm.evmAddress
          ? `Phantom verified for ${maskPhantomWalletAddress(nextWalletAddress)} with EVM readiness detected.`
          : `Phantom verified for ${maskPhantomWalletAddress(nextWalletAddress)}.`,
      })
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : resolveProviderErrorMessage(error, "connect")
      setSaveStatus({ type: "error", message })
    } finally {
      setIsSavingTarget(null)
    }
  }, [onRequireLogin, openBrowserConnect, openPhantomInstall, refreshFromServer, setIsSavingTarget, setSaveStatus])

  return {
    hydrate,
    refreshFromServer,
    connectPhantom,
    disconnectPhantom,
    openBrowserConnect,
    openPhantomInstall,
    refreshProviderState,
    savePhantomPreferences,
    walletAddress,
    walletLabel,
    connectedAt,
    verifiedAt,
    lastDisconnectedAt,
    evmAddress,
    evmLabel,
    evmChainId,
    evmConnectedAt,
    evmAvailable,
    providerInstalled,
    providerReady,
    providerSupportedContext,
    providerContextReason,
    trustedReconnectReady,
  }
}
