"use client"

import Link from "next/link"
import { useDeferredValue, useEffect, useMemo, useRef, useState, startTransition, type CSSProperties, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Activity, ArrowUpRight, CandlestickChart, RefreshCw, Search, Settings, ShieldCheck, TrendingUp, Wallet } from "lucide-react"

import { useSpotlightEffect } from "@/app/integrations/hooks"
import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { PolymarketIcon } from "@/components/icons"
import { SettingsModal } from "@/components/settings/settings-modal"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { useTheme } from "@/lib/context/theme-context"
import { buildIntegrationsHref } from "@/lib/integrations/navigation"
import { loadIntegrationsSettings, saveIntegrationsSettings, type IntegrationsSettings } from "@/lib/integrations/store/client-store"
import { buildPolymarketMarketUrl, normalizePolymarketMarket, type PolymarketMarket, type PolymarketPosition } from "@/lib/integrations/polymarket/api"
import { connectPolymarketWallet, createPolymarketBrowserTrader } from "@/lib/integrations/polymarket/browser"
import { normalizePolymarketIntegrationConfig } from "@/lib/integrations/polymarket/types"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { NOVA_VERSION } from "@/lib/meta/version"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type OrbColor } from "@/lib/settings/userSettings"
import { cn } from "@/lib/shared/utils"

function hexToRgbTriplet(hex: string): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value)
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "0.0%"
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--"
  return `${Math.round(value * 100)}c`
}

function formatAddress(value: string): string {
  const normalized = String(value || "").trim()
  if (!normalized) return "Not connected"
  if (normalized.length <= 12) return normalized
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`
}

function applyPolymarketConfig(prev: IntegrationsSettings, nextPolymarket: IntegrationsSettings["polymarket"]): IntegrationsSettings {
  const next = { ...prev, polymarket: normalizePolymarketIntegrationConfig(nextPolymarket) }
  saveIntegrationsSettings(next)
  return next
}

function SectionHeader({ icon, title, action, isLight }: { icon: ReactNode; title: string; action?: ReactNode; isLight: boolean }) {
  return (
    <div className="relative flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-s-80">{icon}</div>
      <h2 className={cn("absolute left-1/2 -translate-x-1/2 text-sm font-semibold uppercase tracking-[0.22em]", isLight ? "text-s-90" : "text-slate-200")}>{title}</h2>
      <div>{action ?? <div className="w-[3.75rem]" />}</div>
    </div>
  )
}

export default function PolymarketPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pageActive = usePageActive()
  const { theme } = useTheme()
  const { state: novaState, connected: agentConnected } = useNovaState()
  const isLight = theme === "light"

  const shellRef = useRef<HTMLDivElement | null>(null)
  const overviewRef = useRef<HTMLElement | null>(null)
  const feedRef = useRef<HTMLElement | null>(null)
  const ticketRef = useRef<HTMLElement | null>(null)
  const activityRef = useRef<HTMLElement | null>(null)

  const [settings, setSettings] = useState<IntegrationsSettings>(() => loadIntegrationsSettings())
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [orbHovered, setOrbHovered] = useState(false)
  const [markets, setMarkets] = useState<PolymarketMarket[]>([])
  const [selectedMarket, setSelectedMarket] = useState<PolymarketMarket | null>(null)
  const [positions, setPositions] = useState<PolymarketPosition[]>([])
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [loadingMarkets, setLoadingMarkets] = useState(false)
  const [loadingPortfolio, setLoadingPortfolio] = useState(false)
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [submittingTrade, setSubmittingTrade] = useState(false)
  const [savePending, setSavePending] = useState(false)
  const [status, setStatus] = useState("")
  const [activityError, setActivityError] = useState("")
  const [error, setError] = useState("")
  const [orderAction, setOrderAction] = useState<"buy" | "sell">("buy")
  const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState(0)
  const [amount, setAmount] = useState("25")
  const [openOrders, setOpenOrders] = useState<unknown[]>([])
  const [recentTrades, setRecentTrades] = useState<unknown[]>([])
  const requestedSlug = String(searchParams.get("slug") || "").trim()
  const requestedOutcome = String(searchParams.get("outcome") || "").trim().toLowerCase()
  const requestedSide = String(searchParams.get("side") || "").trim().toLowerCase()

  const selectedOutcome = selectedMarket?.outcomes[selectedOutcomeIndex] || selectedMarket?.outcomes[0] || null
  const selectedOutcomePrice = (selectedOutcome?.bestAsk || selectedOutcome?.price || selectedOutcome?.lastTradePrice || 0) > 0
    ? (selectedOutcome?.bestAsk || selectedOutcome?.price || selectedOutcome?.lastTradePrice || 0)
    : 0
  const numericAmount = Number.parseFloat(amount)

  const estimateLabel = useMemo(() => {
    if (!selectedOutcome || !Number.isFinite(numericAmount) || numericAmount <= 0) return "--"
    return orderAction === "buy"
      ? `${(selectedOutcomePrice > 0 ? numericAmount / selectedOutcomePrice : 0).toFixed(2)} shares est.`
      : `${formatUsd((selectedOutcomePrice > 0 ? numericAmount * selectedOutcomePrice : 0))} est. proceeds`
  }, [numericAmount, orderAction, selectedOutcome, selectedOutcomePrice])

  useEffect(() => {
    const sync = () => {
      try {
        const userSettings = loadUserSettings()
        setOrbColor(userSettings.app.orbColor in ORB_COLORS ? userSettings.app.orbColor : "violet")
        setSpotlightEnabled(userSettings.app.spotlightEnabled ?? true)
      } catch {
        setOrbColor("violet")
        setSpotlightEnabled(true)
      }
    }
    sync()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
  }, [])

  useSpotlightEffect(spotlightEnabled, [
    { ref: shellRef, showSpotlightCore: false },
    { ref: overviewRef, showSpotlightCore: false },
    { ref: feedRef, showSpotlightCore: false },
    { ref: ticketRef, showSpotlightCore: false },
    { ref: activityRef, showSpotlightCore: false },
  ], [isLight, spotlightEnabled])

  const orbPalette = ORB_COLORS[orbColor]
  const presence = getNovaPresence({ agentConnected, novaState })
  const orbHoverFilter = `drop-shadow(0 0 8px ${hexToRgba(orbPalette.circle1, 0.55)}) drop-shadow(0 0 14px ${hexToRgba(orbPalette.circle2, 0.35)})`
  const panelClass = isLight ? "rounded-2xl border border-[#d9e0ea] bg-white" : "home-module-surface rounded-2xl border backdrop-blur-xl shadow-[0_20px_60px_-35px_rgba(var(--accent-rgb),0.35)]"
  const subPanelClass = isLight ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]" : "home-subpanel-surface rounded-lg border backdrop-blur-md"
  const panelStyle = {
    "--home-orb-rgb-primary": hexToRgbTriplet(orbPalette.circle1),
    "--home-orb-rgb-secondary": hexToRgbTriplet(orbPalette.circle2),
    "--home-orb-rgb-bg": hexToRgbTriplet(orbPalette.bg),
  } as CSSProperties

  useEffect(() => {
    let cancelled = false
    setLoadingMarkets(true)
    setError("")
    const url = new URL("/api/polymarket/markets", window.location.origin)
    if (deferredSearch.trim()) {
      url.searchParams.set("q", deferredSearch.trim())
      url.searchParams.set("limit", "18")
    } else {
      url.searchParams.set("tag", "crypto")
      url.searchParams.set("limit", "12")
    }
    fetch(url.toString(), { cache: "no-store", credentials: "include" })
      .then(async (res) => ({ ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) }))
      .then(({ ok, status, data }) => {
        if (cancelled) return
        if (status === 401) return void router.push(`/login?next=${encodeURIComponent("/polymarket")}`)
        if (!ok || !Array.isArray(data?.markets)) throw new Error(String(data?.error || "Failed to load Polymarket markets."))
        const nextMarkets = data.markets
          .map((entry: unknown) => normalizePolymarketMarket(entry))
          .filter((entry: PolymarketMarket | null): entry is PolymarketMarket => Boolean(entry))
        setMarkets(nextMarkets)
        setSelectedMarket((prev) => {
          const requested = requestedSlug ? nextMarkets.find((entry: PolymarketMarket) => entry.slug === requestedSlug) : null
          if (requested) return requested
          return nextMarkets.find((entry: PolymarketMarket) => entry.slug === prev?.slug) || nextMarkets[0] || null
        })
      })
      .catch((reason) => !cancelled && setError(reason instanceof Error ? reason.message : "Failed to load Polymarket markets."))
      .finally(() => !cancelled && setLoadingMarkets(false))
    return () => { cancelled = true }
  }, [deferredSearch, requestedSlug, router])

  useEffect(() => {
    if (!settings.polymarket.connected) return void setPositions([])
    let cancelled = false
    setLoadingPortfolio(true)
    fetch("/api/polymarket/portfolio", { cache: "no-store", credentials: "include" })
      .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || !Array.isArray(data?.positions)) throw new Error("Failed to load positions.")
        setPositions(data.positions as PolymarketPosition[])
      })
      .catch(() => !cancelled && setPositions([]))
      .finally(() => !cancelled && setLoadingPortfolio(false))
    return () => { cancelled = true }
  }, [settings.polymarket.connected])

  useEffect(() => {
    if (requestedSide === "buy" || requestedSide === "sell") {
      setOrderAction(requestedSide)
    }
  }, [requestedSide])

  useEffect(() => {
    if (!selectedMarket) return
    if (requestedOutcome === "1" || requestedOutcome === "no") {
      setSelectedOutcomeIndex(1)
      return
    }
    if (requestedOutcome === "0" || requestedOutcome === "yes") {
      setSelectedOutcomeIndex(0)
    }
  }, [requestedOutcome, selectedMarket])

  const handleConnect = async () => {
    setSavePending(true); setError(""); setStatus("")
    try {
      const binding = await connectPolymarketWallet(window)
      const res = await fetch("/api/polymarket/connect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: binding.walletAddress, signatureType: 0, liveTradingEnabled: settings.polymarket.liveTradingEnabled }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) return void router.push(`/login?next=${encodeURIComponent("/polymarket")}`)
      if (!res.ok || !data?.config) throw new Error(String(data?.error || "Failed to connect Polymarket."))
      setSettings((prev) => applyPolymarketConfig(prev, data.config))
      setStatus(`Connected ${binding.walletAddress} on Polygon.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to connect Polymarket.")
    } finally {
      setSavePending(false)
    }
  }

  const handleDisconnect = async () => {
    setSavePending(true); setError(""); setStatus("")
    try {
      const res = await fetch("/api/polymarket/disconnect", { method: "POST", credentials: "include" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.config) throw new Error(String(data?.error || "Failed to disconnect Polymarket."))
      setSettings((prev) => applyPolymarketConfig(prev, data.config))
      setOpenOrders([]); setRecentTrades([]); setPositions([]); setStatus("Disconnected Polymarket.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to disconnect Polymarket.")
    } finally {
      setSavePending(false)
    }
  }

  const handleToggleLiveTrading = async (nextValue: boolean) => {
    setSavePending(true); setError("")
    try {
      const res = await fetch("/api/polymarket/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveTradingEnabled: nextValue }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.config) throw new Error(String(data?.error || "Failed to update Polymarket settings."))
      setSettings((prev) => applyPolymarketConfig(prev, data.config))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to update Polymarket settings.")
    } finally {
      setSavePending(false)
    }
  }

  const loadAuthenticatedActivity = async () => {
    if (!settings.polymarket.connected) return
    setLoadingActivity(true); setActivityError("")
    try {
      const trader = await createPolymarketBrowserTrader({ walletAddress: settings.polymarket.walletAddress, profileAddress: settings.polymarket.profileAddress })
      const [orders, trades] = await Promise.all([trader.getOpenOrders(), trader.getTrades()])
      setOpenOrders(Array.isArray(orders) ? orders.slice(0, 8) : [])
      setRecentTrades(Array.isArray(trades) ? trades.slice(0, 8) : [])
    } catch (reason) {
      setActivityError(reason instanceof Error ? reason.message : "Failed to load authenticated activity.")
    } finally {
      setLoadingActivity(false)
    }
  }

  const handleSubmitTrade = async () => {
    if (!selectedMarket || !selectedOutcome) return void setError("Select a market before placing a trade.")
    if (!settings.polymarket.connected) return void setError("Connect your Polymarket wallet first.")
    if (!settings.polymarket.liveTradingEnabled) return void setError("Enable live trading before placing orders.")
    if (!selectedOutcome.tokenId) return void setError("This market is missing a tradable token.")
    setSubmittingTrade(true); setError(""); setStatus("")
    try {
      const trader = await createPolymarketBrowserTrader({ walletAddress: settings.polymarket.walletAddress, profileAddress: settings.polymarket.profileAddress })
      const response = orderAction === "buy"
        ? await trader.submitBuyOrder({ tokenId: selectedOutcome.tokenId, amountUsd: numericAmount, tickSize: selectedMarket.orderPriceMinTickSize, negRisk: selectedMarket.negRisk })
        : await trader.submitSellOrder({ tokenId: selectedOutcome.tokenId, shares: numericAmount, tickSize: selectedMarket.orderPriceMinTickSize, negRisk: selectedMarket.negRisk })
      setStatus(`${orderAction === "buy" ? "Buy" : "Sell"} order sent for ${selectedOutcome.label}.${typeof (response as { orderID?: unknown })?.orderID === "string" ? ` Order ID ${(response as { orderID: string }).orderID}.` : ""}`)
      await loadAuthenticatedActivity()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to submit live trade.")
    } finally {
      setSubmittingTrade(false)
    }
  }

  return (
    <div ref={shellRef} style={panelStyle} className={cn("relative flex min-h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-[#0a0a0f] text-slate-100")}>
      <div className="relative z-10 flex w-full flex-col px-4 py-4 sm:px-6">
        <header className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => router.push("/home")} onMouseEnter={() => setOrbHovered(true)} onMouseLeave={() => setOrbHovered(false)} className="flex h-11 w-11 items-center justify-center rounded-full transition-all duration-150 hover:scale-110" aria-label="Go to home">
              <NovaOrbIndicator palette={orbPalette} size={30} animated={pageActive} style={{ filter: orbHovered ? orbHoverFilter : "none" }} />
            </button>
            <div className="min-w-0">
              <div className="flex items-baseline gap-3">
                <h1 className={cn("text-[30px] leading-none font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>NovaOS</h1>
                <p className="text-[11px] font-mono text-accent">{NOVA_VERSION}</p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-1.5">
                  <span className={cn("h-2.5 w-2.5 rounded-full animate-pulse", presence.dotClassName)} />
                  <span className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", presence.textClassName)}>{presence.label}</span>
                </div>
                <p className={cn("text-[13px]", isLight ? "text-s-50" : "text-slate-400")}>Polymarket Trading Surface</p>
              </div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Market Feed", value: loadingMarkets ? "Syncing" : String(markets.length), dotClass: "bg-sky-400" },
              { label: "Selected Price", value: selectedOutcome ? formatPrice(selectedOutcome.price || selectedOutcome.lastTradePrice) : "--", dotClass: "bg-accent" },
              { label: "Open Positions", value: String(positions.length), dotClass: "bg-emerald-400" },
              { label: "Trading", value: settings.polymarket.liveTradingEnabled ? "Enabled" : "Locked", dotClass: settings.polymarket.liveTradingEnabled ? "bg-emerald-400" : "bg-amber-400" },
            ].map((tile) => (
              <div key={tile.label} className={cn("home-spotlight-card home-border-glow flex h-10 items-center justify-between rounded-md border px-2.5 py-1.5", subPanelClass)}>
                <div className="min-w-0">
                  <p className={cn("truncate text-[9px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-400")}>{tile.label}</p>
                  <p className={cn("text-sm font-semibold leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{tile.value}</p>
                </div>
                <span className={cn("h-2.5 w-2.5 rounded-sm", tile.dotClass)} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-start gap-2 xl:justify-end">
            <button onClick={() => setSettingsOpen(true)} className={cn("home-spotlight-card home-border-glow group/polymarket-settings h-11 w-11 rounded-lg transition-colors", subPanelClass)} aria-label="Open settings" title="Settings">
              <Settings className="mx-auto h-5 w-5 text-s-50 transition-transform duration-200 group-hover/polymarket-settings:rotate-90 group-hover/polymarket-settings:text-accent" />
            </button>
          </div>
        </header>

        {(status || error) ? <div className="pointer-events-none fixed left-1/2 top-5 z-70 -translate-x-1/2"><div className={cn("rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur-md", error ? "border-rose-300/40 bg-rose-500/15 text-rose-200" : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200")}>{error || status}</div></div> : null}

        <div className="min-h-0 flex-1 overflow-y-auto pr-1 module-hover-scroll">
          <section ref={overviewRef} className={cn(panelClass, "home-spotlight-shell mb-4 p-4")}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_auto] lg:items-center">
              <div>
                <div className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em]", isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70" : "border-white/12 bg-black/20 text-slate-300")}><PolymarketIcon className="h-4 w-4" />Polymarket Live</div>
                <h2 className={cn("mt-3 text-[28px] font-semibold leading-tight tracking-tight", isLight ? "text-s-90" : "text-white")}>Prediction markets, Phantom wallet control, and Nova-native live execution.</h2>
                <p className={cn("mt-2 max-w-3xl text-sm leading-6", isLight ? "text-s-60" : "text-slate-300")}>This now uses the same Nova shell language as the rest of the HUD: orb header, spotlight panels, compact status tiles, and integrated trading controls.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:w-[25rem]">
                <button type="button" onClick={settings.polymarket.connected ? handleDisconnect : handleConnect} disabled={savePending} className={cn("home-spotlight-card home-border-glow h-11 rounded-lg border px-3 text-sm font-medium transition-colors", settings.polymarket.connected ? "border-rose-300/30 bg-rose-500/12 text-rose-100 hover:bg-rose-500/18" : "border-emerald-300/30 bg-emerald-500/12 text-emerald-100 hover:bg-emerald-500/18")}><span className="inline-flex items-center gap-2"><Wallet className="h-4 w-4" />{savePending ? "Working..." : settings.polymarket.connected ? "Disconnect Wallet" : "Connect Wallet"}</span></button>
                <button type="button" onClick={() => router.push("/integrations?setup=polymarket")} className={cn("home-spotlight-card home-border-glow h-11 rounded-lg border px-3 text-sm font-medium transition-colors", isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70 hover:text-accent" : "border-white/15 bg-black/25 text-slate-300 hover:text-white")}><span className="inline-flex items-center gap-2">Setup<ArrowUpRight className="h-4 w-4" /></span></button>
                <label className={cn("home-spotlight-card home-border-glow flex h-11 items-center justify-between rounded-lg border px-3", subPanelClass)}><span className={cn("text-sm", isLight ? "text-s-70" : "text-slate-200")}>Live trading</span><input type="checkbox" checked={Boolean(settings.polymarket.liveTradingEnabled)} disabled={!settings.polymarket.connected || savePending} onChange={(event) => void handleToggleLiveTrading(event.target.checked)} className="h-4 w-4 rounded border-white/20 bg-transparent" /></label>
                <button type="button" onClick={() => void loadAuthenticatedActivity()} disabled={!settings.polymarket.connected || loadingActivity} className={cn("home-spotlight-card home-border-glow h-11 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-60", isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70 hover:text-accent" : "border-white/15 bg-black/25 text-slate-300 hover:text-white")}><span className="inline-flex items-center gap-2"><RefreshCw className={cn("h-4 w-4", loadingActivity && "animate-spin")} />Refresh Activity</span></button>
              </div>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{[{ label: "Wallet", value: formatAddress(settings.polymarket.walletAddress) }, { label: "Profile", value: formatAddress(settings.polymarket.profileAddress) }, { label: "Trading", value: settings.polymarket.liveTradingEnabled ? "Enabled" : "Approval required" }, { label: "Last Sync", value: settings.polymarket.lastProfileSyncAt || "Not synced" }].map((item) => <div key={item.label} className={cn("home-spotlight-card home-border-glow rounded-xl border p-3", subPanelClass)}><p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>{item.label}</p><p className={cn("mt-1 text-sm font-medium", isLight ? "text-s-90" : "text-slate-100")}>{item.value}</p></div>)}</div>
          </section>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(21rem,0.92fr)]">
            <section ref={feedRef} className={cn(panelClass, "home-spotlight-shell p-4")}>
              <SectionHeader icon={<TrendingUp className="h-4 w-4 text-accent" />} title="Market Feed" isLight={isLight} action={<Link href="/home" className={cn("home-spotlight-card home-border-glow home-spotlight-card--hover inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] uppercase tracking-[0.12em] transition-colors", subPanelClass)}>Home</Link>} />
              <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div><p className={cn("text-sm font-medium", isLight ? "text-s-90" : "text-slate-100")}>Active market flow</p><p className={cn("mt-0.5 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>Search markets or keep the crypto-heavy feed pinned on the left.</p></div>
                <div className="relative w-full lg:w-80"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search live markets" className={cn("h-10 w-full rounded-lg border pl-10 pr-3 text-sm outline-none transition-colors", isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-90 placeholder:text-s-40 focus:bg-white" : "home-subpanel-surface text-slate-100 placeholder:text-slate-500 focus:border-white/20")} /></div>
              </div>
              <div className="mt-4 max-h-[40rem] space-y-2 overflow-y-auto pr-1 module-hover-scroll">
                {loadingMarkets ? <div className={cn("home-spotlight-card home-border-glow rounded-xl border p-4 text-sm", subPanelClass)}>Loading markets...</div> : null}
                {!loadingMarkets && markets.length === 0 ? <div className={cn("home-spotlight-card home-border-glow rounded-xl border p-4 text-sm", subPanelClass)}>No active markets matched this query.</div> : null}
                {markets.map((market) => { const isSelected = selectedMarket?.slug === market.slug; return <button key={market.slug} type="button" onClick={() => { startTransition(() => setSelectedMarket(market)); setSelectedOutcomeIndex(0) }} className={cn("home-spotlight-card home-border-glow w-full rounded-xl border p-3 text-left transition-colors", isSelected ? (isLight ? "border-accent-30 bg-[#eef3fb]" : "border-accent-30 bg-accent-10") : subPanelClass)}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className={cn("text-[13px] font-semibold leading-5", isLight ? "text-s-90" : "text-slate-100")}>{market.question}</p><p className={cn("mt-1 text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>{market.tags.slice(0, 3).map((tag) => tag.label).join(" / ") || "Polymarket"}</p></div><span className={cn("rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.16em]", isLight ? "border-[#d5dce8] text-s-50" : "border-white/10 text-slate-400")}>{market.acceptingOrders ? "Live" : "Watch"}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{market.outcomes.slice(0, 2).map((outcome) => <div key={`${market.slug}-${outcome.index}`} className={cn("rounded-lg border px-3 py-2", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}><div className="flex items-center justify-between gap-3"><span className={cn("text-sm", isLight ? "text-s-70" : "text-slate-300")}>{outcome.label}</span><span className={cn("text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{formatPrice(outcome.price || outcome.lastTradePrice)}</span></div><div className={cn("mt-2 flex items-center justify-between text-[10px]", isLight ? "text-s-50" : "text-slate-500")}><span>Bid {formatPrice(outcome.bestBid)}</span><span>Ask {formatPrice(outcome.bestAsk)}</span></div></div>)}</div><div className={cn("mt-3 flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}><span>24h {formatUsd(market.volume24hr)}</span><span>Liquidity {formatUsd(market.liquidity)}</span><span>Min {market.orderMinSize || 5}</span></div></button>})}
              </div>
            </section>
            <section ref={ticketRef} className="space-y-4">
              <div className={cn(panelClass, "home-spotlight-shell p-4")}>
                <SectionHeader icon={<CandlestickChart className="h-4 w-4 text-accent" />} title="Trade Ticket" isLight={isLight} action={selectedMarket ? <Link href={buildPolymarketMarketUrl(selectedMarket.slug)} target="_blank" className={cn("home-spotlight-card home-border-glow home-spotlight-card--hover inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] uppercase tracking-[0.12em] transition-colors", subPanelClass)}>Open<ArrowUpRight className="h-3 w-3" /></Link> : undefined} />
                {selectedMarket ? <>
                  <div className="mt-3"><p className={cn("text-base font-semibold leading-snug", isLight ? "text-s-90" : "text-slate-100")}>{selectedMarket.question}</p><p className={cn("mt-1 text-[11px] leading-5", isLight ? "text-s-50" : "text-slate-400")}>{selectedMarket.description || "Select an outcome, size the order, and route execution through Phantom approval."}</p></div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">{selectedMarket.outcomes.slice(0, 2).map((outcome) => <button key={`${selectedMarket.slug}-${outcome.index}`} type="button" onClick={() => setSelectedOutcomeIndex(outcome.index)} className={cn("home-spotlight-card home-border-glow rounded-xl border px-4 py-3 text-left transition-colors", selectedOutcome?.index === outcome.index ? (isLight ? "border-accent-30 bg-[#eef3fb]" : "border-accent-30 bg-accent-10") : subPanelClass)}><div className="flex items-center justify-between gap-3"><span className={cn("text-sm", isLight ? "text-s-70" : "text-slate-200")}>{outcome.label}</span><span className={cn("text-base font-semibold", isLight ? "text-s-90" : "text-white")}>{formatPrice(outcome.price || outcome.lastTradePrice)}</span></div><div className={cn("mt-2 text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Bid {formatPrice(outcome.bestBid)} / Ask {formatPrice(outcome.bestAsk)}</div></button>)}</div>
                  <div className={cn("mt-4 rounded-xl border p-4", subPanelClass)}>
                    <div className="flex gap-2">{(["buy", "sell"] as const).map((value) => <button key={value} type="button" onClick={() => setOrderAction(value)} className={cn("home-spotlight-card home-border-glow rounded-lg border px-3 py-2 text-sm capitalize transition-colors", orderAction === value ? (value === "buy" ? "border-emerald-300/35 bg-emerald-500/14 text-emerald-100" : "border-amber-300/35 bg-amber-500/14 text-amber-100") : (isLight ? "border-[#d5dce8] bg-white text-s-70" : "border-white/10 bg-black/20 text-slate-300"))}>{value}</button>)}</div>
                    <label className="mt-4 block"><span className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-500")}>{orderAction === "buy" ? "Spend (USDC)" : "Sell size (shares)"}</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className={cn("mt-2 h-11 w-full rounded-xl border px-3 text-sm outline-none transition-colors", isLight ? "border-[#d5dce8] bg-white text-s-90" : "border-white/10 bg-black/25 text-white focus:border-white/20")} /></label>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2"><div className={cn("rounded-lg border p-3", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}><p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Estimate</p><p className={cn("mt-1 text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{estimateLabel}</p></div><div className={cn("rounded-lg border p-3", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}><p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Route</p><p className={cn("mt-1 text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{selectedOutcome ? `${selectedOutcome.label} @ ${formatPrice(selectedOutcomePrice)}` : "--"}</p></div></div>
                    <button type="button" onClick={() => void handleSubmitTrade()} disabled={submittingTrade || !selectedMarket || !selectedOutcome} className={cn("mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60", orderAction === "buy" ? "border-emerald-300/30 bg-emerald-500/12 text-emerald-100 hover:bg-emerald-500/18" : "border-amber-300/30 bg-amber-500/12 text-amber-100 hover:bg-amber-500/18")}><CandlestickChart className="h-4 w-4" />{submittingTrade ? "Submitting..." : `Place ${orderAction} order`}</button>
                  </div>
                </> : <div className={cn("mt-3 rounded-xl border p-4 text-sm", subPanelClass)}>Select a market from the left column to open the ticket.</div>}
              </div>
              <div className={cn(panelClass, "home-spotlight-shell p-4")}>
                <SectionHeader icon={<ShieldCheck className="h-4 w-4 text-accent" />} title="Guardrails" isLight={isLight} />
                <div className="mt-3 grid gap-2">{["Phantom must expose a verified EVM address before Polymarket can bind.", "Nova stores binding and preferences only. Keys and approvals stay in the wallet.", "Disconnecting Phantom clears stale Polymarket identity so wallet drift cannot persist."].map((copy) => <div key={copy} className={cn("home-spotlight-card home-border-glow rounded-xl border p-3 text-sm leading-6", subPanelClass, isLight ? "text-s-70" : "text-slate-300")}>{copy}</div>)}</div>
              </div>
            </section>
          </div>
          <section ref={activityRef} className={cn(panelClass, "home-spotlight-shell mt-4 p-4")}>
            <SectionHeader icon={<Activity className="h-4 w-4 text-accent" />} title="Portfolio And Activity" isLight={isLight} action={<button type="button" onClick={() => void loadAuthenticatedActivity()} disabled={!settings.polymarket.connected || loadingActivity} className={cn("home-spotlight-card home-border-glow home-spotlight-card--hover inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] uppercase tracking-[0.12em] transition-colors disabled:opacity-60", subPanelClass)}><RefreshCw className={cn("h-3 w-3", loadingActivity && "animate-spin")} />Refresh</button>} />
            {activityError ? <p className="mt-3 text-sm text-rose-300">{activityError}</p> : null}
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <div className={cn("rounded-2xl border p-4", subPanelClass)}>
                <p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-500")}>Positions</p>
                <div className="mt-3 max-h-[22rem] space-y-3 overflow-y-auto pr-1 module-hover-scroll">
                  {loadingPortfolio ? <p className="text-sm text-slate-400">Loading positions...</p> : null}
                  {!loadingPortfolio && positions.length === 0 ? <p className="text-sm text-slate-400">No positions found for this Polymarket profile.</p> : null}
                  {positions.slice(0, 8).map((position) => <div key={`${position.tokenId}-${position.outcome}`} className={cn("rounded-xl border p-3", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}><p className={cn("text-sm font-medium", isLight ? "text-s-90" : "text-slate-100")}>{position.title || position.slug}</p><div className={cn("mt-2 flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}><span>{position.outcome || "Outcome"}</span><span>{position.size.toFixed(2)} shares</span><span>{formatUsd(position.currentValue)}</span><span className={position.percentPnl >= 0 ? "text-emerald-300" : "text-rose-300"}>{formatPct(position.percentPnl)}</span></div></div>)}
                </div>
              </div>
              <div className={cn("rounded-2xl border p-4", subPanelClass)}>
                <p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-500")}>Wallet-authenticated flow</p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className={cn("rounded-xl border p-3", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}><p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Open Orders</p><div className="mt-2 space-y-2">{openOrders.length === 0 ? <p className="text-sm text-slate-400">Refresh to load current open orders.</p> : openOrders.slice(0, 4).map((entry, index) => { const row = entry as Record<string, unknown>; return <div key={`order-${index}`} className={cn("rounded-lg border p-2.5 text-sm", isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70" : "border-white/10 bg-black/20 text-slate-300")}>Open order {String(row.market || row.asset_id || row.id || "unknown")}</div> })}</div></div>
                  <div className={cn("rounded-xl border p-3", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}><p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Recent Trades</p><div className="mt-2 space-y-2">{recentTrades.length === 0 ? <p className="text-sm text-slate-400">Recent fills appear here after wallet-authenticated refresh.</p> : recentTrades.slice(0, 4).map((entry, index) => { const row = entry as Record<string, unknown>; return <div key={`trade-${index}`} className={cn("rounded-lg border p-2.5", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}><p className={cn("text-sm font-medium", isLight ? "text-s-90" : "text-slate-100")}>{String(row.market || row.asset_id || "Trade")}</p><div className={cn("mt-2 flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}><span>{String(row.side || "side")}</span><span>{String(row.size || "--")} shares</span><span>{String(row.price || "--")}</span></div></div> })}</div></div>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href={buildIntegrationsHref("phantom")} className={cn("home-spotlight-card home-border-glow inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold tracking-[0.12em] transition-colors", isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70 hover:text-accent" : "border-white/15 bg-black/25 text-slate-300 hover:text-white")}>Open Phantom Setup<ArrowUpRight className="h-4 w-4" /></Link>
              <Link href="/integrations?setup=polymarket" className={cn("home-spotlight-card home-border-glow inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold tracking-[0.12em] transition-colors", isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70 hover:text-accent" : "border-white/15 bg-black/25 text-slate-300 hover:text-white")}>Open Polymarket Integration<ArrowUpRight className="h-4 w-4" /></Link>
            </div>
          </section>
        </div>
      </div>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
