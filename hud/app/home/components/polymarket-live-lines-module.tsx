"use client"
import { createPortal } from "react-dom"
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { ArrowUpRight, BarChart2, CandlestickChart, RefreshCw, Wallet, X } from "lucide-react"

import { useSpotlightEffect } from "@/app/integrations/hooks"
import { normalizePolymarketMarket, type PolymarketMarket } from "@/lib/integrations/polymarket/api"
import { createPolymarketBrowserTrader } from "@/lib/integrations/polymarket/browser"
import { loadIntegrationsSettings, type IntegrationsSettings } from "@/lib/integrations/store/client-store"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { cn } from "@/lib/shared/utils"

interface PolymarketLiveLinesModuleProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties | undefined
  className?: string
  onOpenIntegrations: () => void
  onOpenPolymarket: () => void
}

interface LaunchOrigin {
  left: number
  top: number
  width: number
  height: number
}

interface InspectState {
  market: PolymarketMarket
  origin: LaunchOrigin
  launchId: number
}

interface LaunchGeometry {
  transform: string
  origin: string
}

interface MarketNarrativeSection {
  title: string
  paragraphs: string[]
}

function isNarrativeHeading(line: string): boolean {
  const normalized = line.replace(/:$/, "").trim()
  return normalized.length > 0
    && normalized.length <= 36
    && !/[.!?]$/.test(normalized)
    && /^[A-Z][A-Za-z0-9/&' -]+$/.test(normalized)
}

function parseMarketNarrative(description: string): { sections: MarketNarrativeSection[]; inlineOpenedAt: string } {
  const normalized = String(description || "").replace(/\r/g, "").trim()
  if (!normalized) return { sections: [], inlineOpenedAt: "" }

  const sections: MarketNarrativeSection[] = []
  let current: MarketNarrativeSection | null = null
  let inlineOpenedAt = ""

  const ensureCurrent = () => {
    if (!current) current = { title: "Market Context", paragraphs: [] }
  }

  const commitCurrent = () => {
    if (current && current.paragraphs.length > 0) sections.push(current)
    current = null
  }

  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean)
    if (lines.length === 0) continue

    let bodyStart = 0
    const headings: string[] = []
    while (bodyStart < lines.length && isNarrativeHeading(lines[bodyStart])) {
      headings.push(lines[bodyStart].replace(/:$/, "").trim())
      bodyStart += 1
    }

    if (headings.length > 0) {
      commitCurrent()
      current = { title: headings.join(" / "), paragraphs: [] }
    }

    if (bodyStart >= lines.length) continue

    ensureCurrent()
    const body = lines.slice(bodyStart).join(" ")
    const openedMatch = /^Market Opened:\s*(.+)$/i.exec(body)
    if (openedMatch) {
      inlineOpenedAt = openedMatch[1].trim()
      continue
    }
    if (!current) continue
    current.paragraphs.push(body)
  }

  commitCurrent()

  if (sections.length === 0) {
    return {
      sections: [{ title: "Market Context", paragraphs: [normalized] }],
      inlineOpenedAt,
    }
  }

  return { sections, inlineOpenedAt }
}

function formatMarketTimestamp(value: string): string {
  const parsed = Date.parse(String(value || "").trim())
  if (!Number.isFinite(parsed)) return ""
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(new Date(parsed))
}

function getChanceToneClasses(chance: number, isLight: boolean): string {
  if (chance >= 0.75) {
    return isLight
      ? "border-emerald-600/30 bg-emerald-100 text-emerald-900"
      : "border-emerald-400/40 bg-emerald-500/18 text-emerald-200"
  }
  if (chance >= 0.5) {
    return isLight
      ? "border-amber-400/40 bg-amber-100 text-amber-900"
      : "border-amber-300/40 bg-amber-500/18 text-amber-200"
  }
  if (chance >= 0.25) {
    return isLight
      ? "border-orange-400/40 bg-orange-100 text-orange-900"
      : "border-orange-300/40 bg-orange-500/18 text-orange-200"
  }
  return isLight
    ? "border-rose-400/40 bg-rose-100 text-rose-900"
    : "border-rose-300/40 bg-rose-500/18 text-rose-200"
}

export function PolymarketLiveLinesModule({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  className,
  onOpenIntegrations,
  onOpenPolymarket,
}: PolymarketLiveLinesModuleProps) {
  const [markets, setMarkets] = useState<PolymarketMarket[]>([])
  const [inspectState, setInspectState] = useState<InspectState | null>(null)
  const [spotlightEnabled, setSpotlightEnabled] = useState(() => loadUserSettings().app.spotlightEnabled ?? true)
  const [portalReady, setPortalReady] = useState(false)
  const [overlayPhase, setOverlayPhase] = useState<"closed" | "measuring" | "open" | "closing">("closed")
  const [launchGeometry, setLaunchGeometry] = useState<LaunchGeometry>({
    transform: "translate3d(0, 24px, 0) scale(0.94) rotateX(-3deg) rotateY(0deg)",
    origin: "50% 18%",
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [quickSettings, setQuickSettings] = useState<IntegrationsSettings>(() => loadIntegrationsSettings())
  const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState(0)
  const [quickAmount, setQuickAmount] = useState("")
  const [submittingTrade, setSubmittingTrade] = useState(false)
  const [tradeStatus, setTradeStatus] = useState("")
  const [tradeError, setTradeError] = useState("")
  const inspectPanelRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const launchRafPrimaryRef = useRef<number | null>(null)
  const launchRafSecondaryRef = useRef<number | null>(null)
  const lastAnimatedLaunchIdRef = useRef(0)
  const launchIdRef = useRef(0)
  const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

  const getOutcomePrice = (market: PolymarketMarket, index: number): number => {
    const outcome = market.outcomes[index]
    if (!outcome) return 0
    return outcome.price || outcome.lastTradePrice || 0
  }

  const formatCentPrice = (value: number): string => `${Math.round(value * 100)}c`

  const formatUsd = (value: number): string =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value)

  const formatShares = (value: number): string => `${value.toFixed(value >= 100 ? 0 : 2)} shares`

  useEffect(() => {
    const syncSpotlight = () => setSpotlightEnabled(loadUserSettings().app.spotlightEnabled ?? true)
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncSpotlight as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncSpotlight as EventListener)
  }, [])

  useSpotlightEffect(
    Boolean(inspectState) && spotlightEnabled,
    [{ ref: inspectPanelRef, showSpotlightCore: false, enableParticles: false, directHoverOnly: true }],
    [Boolean(inspectState), isLight, spotlightEnabled],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/polymarket/markets?tag=crypto&limit=8", { cache: "no-store", credentials: "include" })
      .then(async (res) => ({
        ok: res.ok,
        data: await res.json().catch(() => ({})),
      }))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || !Array.isArray(data?.markets)) {
          throw new Error(String(data?.error || "Failed to load Polymarket markets."))
        }
        const nextMarkets = data.markets
          .map((entry: unknown) => normalizePolymarketMarket(entry))
          .filter((entry: PolymarketMarket | null): entry is PolymarketMarket => Boolean(entry))
          .slice(0, 8)
        setMarkets(nextMarkets)
        setInspectState((prev) => {
          if (!prev) return null
          const nextMarket = nextMarkets.find((entry: PolymarketMarket) => entry.slug === prev.market.slug)
          return nextMarket ? { ...prev, market: nextMarket } : null
        })
        setError("")
      })
      .catch((reason) => {
        if (!cancelled) {
          setMarkets([])
          setError(reason instanceof Error ? reason.message : "Failed to load Polymarket.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setPortalReady(true)
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!inspectState) return

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setOverlayPhase("closing")
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", onEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", onEscape)
    }
  }, [inspectState])

  useEffect(() => {
    const activeSlug = inspectState?.market.slug
    if (!activeSlug) {
      setDetailLoading(false)
      setDetailError("")
      return
    }

    let cancelled = false
    setDetailLoading(true)
    setDetailError("")

    fetch(`/api/polymarket/markets?slug=${encodeURIComponent(activeSlug)}`, {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (res) => ({
        ok: res.ok,
        data: await res.json().catch(() => ({})),
      }))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || !data?.market) {
          throw new Error(String(data?.error || "Failed to load market details."))
        }
        const nextMarket = normalizePolymarketMarket(data.market)
        if (!nextMarket) throw new Error("Failed to normalize market details.")
        setInspectState((prev) => (prev?.market.slug === activeSlug ? { ...prev, market: nextMarket } : prev))
      })
      .catch((reason) => {
        if (!cancelled) setDetailError(reason instanceof Error ? reason.message : "Failed to load market details.")
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [inspectState?.market.slug])

  useEffect(() => {
    if (overlayPhase !== "closing") return
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      setInspectState(null)
      setOverlayPhase("closed")
      closeTimerRef.current = null
    }, 280)
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [overlayPhase])

  useLayoutEffect(() => {
    if (!portalReady || !inspectState || !inspectPanelRef.current) return
    if (lastAnimatedLaunchIdRef.current === inspectState.launchId) return
    lastAnimatedLaunchIdRef.current = inspectState.launchId
    const panel = inspectPanelRef.current
    const { origin } = inspectState

    const finalRect = panel.getBoundingClientRect()
    const originCenterX = origin.left + origin.width / 2
    const originCenterY = origin.top + origin.height / 2
    const finalCenterX = finalRect.left + finalRect.width / 2
    const finalCenterY = finalRect.top + finalRect.height / 2
    const translateX = originCenterX - finalCenterX
    const translateY = originCenterY - finalCenterY
    const scaleX = clamp(origin.width / Math.max(finalRect.width, 1), 0.34, 1)
    const scaleY = clamp(origin.height / Math.max(finalRect.height, 1), 0.26, 1)
    const rotateY = clamp(translateX / 42, -10, 10)
    const rotateX = clamp(-translateY / 56, -8, 8)
    const originXPct = clamp(((originCenterX - finalRect.left) / Math.max(finalRect.width, 1)) * 100, 18, 82)
    const originYPct = clamp(((originCenterY - finalRect.top) / Math.max(finalRect.height, 1)) * 100, 16, 84)

    setLaunchGeometry({
      transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY}) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
      origin: `${originXPct}% ${originYPct}%`,
    })
    setOverlayPhase("measuring")

    if (launchRafPrimaryRef.current) window.cancelAnimationFrame(launchRafPrimaryRef.current)
    if (launchRafSecondaryRef.current) window.cancelAnimationFrame(launchRafSecondaryRef.current)

    launchRafPrimaryRef.current = window.requestAnimationFrame(() => {
      launchRafSecondaryRef.current = window.requestAnimationFrame(() => {
        setOverlayPhase((prev) => (prev === "closing" ? prev : "open"))
      })
    })

    return () => {
      if (launchRafPrimaryRef.current) {
        window.cancelAnimationFrame(launchRafPrimaryRef.current)
        launchRafPrimaryRef.current = null
      }
      if (launchRafSecondaryRef.current) {
        window.cancelAnimationFrame(launchRafSecondaryRef.current)
        launchRafSecondaryRef.current = null
      }
    }
  }, [inspectState?.launchId, portalReady])

  const openInspect = (market: PolymarketMarket, element: HTMLButtonElement) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    const rect = element.getBoundingClientRect()
    setOverlayPhase("closed")
    setLaunchGeometry({
      transform: "translate3d(0, 24px, 0) scale(0.94) rotateX(-3deg) rotateY(0deg)",
      origin: "50% 18%",
    })
    setSelectedOutcomeIndex(0)
    setQuickAmount("")
    setTradeStatus("")
    setTradeError("")
    setDetailError("")
    setQuickSettings(loadIntegrationsSettings())
    launchIdRef.current += 1
    setInspectState({
      market,
      origin: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      launchId: launchIdRef.current,
    })
  }

  const closeInspect = () => {
    setOverlayPhase("closing")
  }

  const activeMarket = inspectState?.market ?? null
  const selectedOutcome = activeMarket?.outcomes[selectedOutcomeIndex] || activeMarket?.outcomes[0] || null
  const selectedOutcomePrice = (selectedOutcome?.bestAsk || selectedOutcome?.price || selectedOutcome?.lastTradePrice || 0) > 0
    ? (selectedOutcome?.bestAsk || selectedOutcome?.price || selectedOutcome?.lastTradePrice || 0)
    : 0
  const numericAmount = Number.parseFloat(quickAmount)
  const estimatedShares = selectedOutcome && Number.isFinite(numericAmount) && numericAmount > 0 && selectedOutcomePrice > 0
    ? numericAmount / selectedOutcomePrice
    : 0
  const estimatedPayout = estimatedShares
  const estimatedProfit = Math.max(0, estimatedPayout - (Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount : 0))
  const overlayVisible = overlayPhase === "open"
  const panelInFlight = overlayPhase === "measuring" || overlayPhase === "closing"
  const overlayPanelClass = cn(
    panelClass,
    "rounded-[1.25rem]",
    isLight
      ? "shadow-[0_24px_64px_-28px_rgba(140,152,174,0.34)]"
      : "shadow-[0_28px_84px_-34px_rgba(0,0,0,0.68)]",
  )
  const overlaySubpanelClass = cn(subPanelClass, "rounded-xl")
  const overlayPanelTransform = overlayPhase === "open"
    ? "translate3d(0, 0, 0) scale(1) rotateX(0deg) rotateY(0deg)"
    : launchGeometry.transform
  const marketNarrative = parseMarketNarrative(activeMarket?.description || "")
  const marketOpenedAt = marketNarrative.inlineOpenedAt || formatMarketTimestamp(activeMarket?.createdAt || activeMarket?.startDate || "")
  const resolutionSourceLabel = activeMarket?.resolutionSource || "Consensus of credible reporting."
  const orbPillClass = isLight
    ? "border-[rgba(var(--home-orb-rgb-primary),0.28)] bg-[rgba(var(--home-orb-rgb-primary),0.10)] text-[rgba(var(--home-orb-rgb-primary),0.92)]"
    : "border-[rgba(var(--home-orb-rgb-primary),0.34)] bg-[rgba(var(--home-orb-rgb-primary),0.16)] text-slate-100"

  const handleQuickBuy = async () => {
    if (!activeMarket || !selectedOutcome) return void setTradeError("Select a side before placing a trade.")
    const latestSettings = loadIntegrationsSettings()
    setQuickSettings(latestSettings)
    if (!latestSettings.polymarket.connected) return void setTradeError("Connect your Polymarket wallet first.")
    if (!latestSettings.polymarket.liveTradingEnabled) return void setTradeError("Enable live trading before placing orders.")
    if (!selectedOutcome.tokenId) return void setTradeError("This market is missing a tradable token.")
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return void setTradeError("Enter a spend amount greater than zero.")

    setSubmittingTrade(true)
    setTradeError("")
    setTradeStatus("")

    try {
      const trader = await createPolymarketBrowserTrader({
        walletAddress: latestSettings.polymarket.walletAddress,
        profileAddress: latestSettings.polymarket.profileAddress,
      })
      const response = await trader.submitBuyOrder({
        tokenId: selectedOutcome.tokenId,
        amountUsd: numericAmount,
        tickSize: activeMarket.orderPriceMinTickSize,
        negRisk: activeMarket.negRisk,
      })
      const orderId =
        typeof (response as { orderID?: unknown })?.orderID === "string"
          ? ` Order ID ${(response as { orderID: string }).orderID}.`
          : ""
      setTradeStatus(`Buy order sent for ${selectedOutcome.label}.${orderId}`)
    } catch (reason) {
      setTradeError(reason instanceof Error ? reason.message : "Failed to submit live trade.")
    } finally {
      setSubmittingTrade(false)
    }
  }

  return (
    <section
      style={panelStyle}
      className={cn(
        `${panelClass} home-spotlight-shell h-[clamp(15rem,30vh,18.5rem)] px-3 pb-2 pt-2.5 flex flex-col`,
        className,
      )}
    >
      <div className="relative flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-s-80">
          <BarChart2 className="h-4 w-4 text-accent" />
        </div>
        <h2
          className={cn(
            "absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-semibold uppercase tracking-[0.22em]",
            isLight ? "text-s-90" : "text-slate-200",
          )}
        >
          Polymarket
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenIntegrations}
            className={cn(
              "home-spotlight-card home-border-glow home-spotlight-card--hover h-7 rounded-md border px-2 text-[10px] uppercase tracking-[0.12em] transition-colors",
              subPanelClass,
            )}
            aria-label="Open integrations"
            title="Open integrations"
          >
            Setup
          </button>
          <button
            onClick={onOpenPolymarket}
            className={cn(
              "home-spotlight-card home-border-glow home-spotlight-card--hover inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] uppercase tracking-[0.12em] transition-colors",
              subPanelClass,
            )}
            aria-label="Open Polymarket"
            title="Open Polymarket"
          >
            Trade
            <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="mt-2 min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">
            <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
            Loading live markets...
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-rose-300">{error}</div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-2 auto-rows-fr gap-1.5">
            {markets.map((market) => (
              <button
                key={market.slug}
                type="button"
                onClick={(event) => openInspect(market, event.currentTarget)}
                className={cn(
                  "home-spotlight-card home-border-glow min-w-0 h-full rounded-md border px-1.5 py-1 text-left transition hover:-translate-y-px",
                  "flex flex-col justify-between",
                  isLight ? "border-[#cdd9ea] bg-[#edf2fb]" : "home-subpanel-surface",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <p className={cn("line-clamp-1 min-w-0 text-[10px] font-semibold leading-tight", isLight ? "text-s-80" : "text-slate-200")}>
                    {market.question}
                  </p>
                  <span className={cn("shrink-0 text-[8px] uppercase tracking-[0.06em]", isLight ? "text-s-50" : "text-slate-400")}>
                    {market.acceptingOrders ? "Live" : "Watch"}
                  </span>
                </div>
                <div className="mt-1 space-y-1">
                  <div className="overflow-hidden rounded-full border border-white/8">
                    <div className="flex h-1.5 w-full">
                      <div
                        className="bg-emerald-400/90"
                        style={{ width: `${Math.max(0, Math.min(100, getOutcomePrice(market, 0) * 100))}%` }}
                      />
                      <div
                        className="bg-rose-400/90"
                        style={{ width: `${Math.max(0, Math.min(100, getOutcomePrice(market, 1) * 100))}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-3 text-[10px] leading-none">
                    {market.outcomes.slice(0, 2).map((outcome) => (
                      <div key={`${market.slug}-${outcome.index}`} className="inline-flex min-w-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "truncate font-medium",
                            isLight ? "text-s-60" : "text-slate-300",
                            outcome.index === 0 ? "text-emerald-300" : outcome.index === 1 ? "text-rose-300" : "",
                          )}
                        >
                          {outcome.label}
                        </span>
                        <span className={cn("shrink-0 font-semibold", isLight ? "text-s-90" : "text-slate-100")}>
                          {Math.round((outcome.price || outcome.lastTradePrice || 0) * 100)}c
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {portalReady && activeMarket
        ? createPortal(
            <div className="fixed inset-0 z-[140]" style={panelStyle}>
              <button
                type="button"
                aria-label="Close quick inspect"
                onClick={closeInspect}
                className="absolute inset-0 bg-black/56 transition-opacity duration-280"
                style={{ opacity: overlayVisible ? 1 : 0 }}
              />

              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 sm:p-6 [perspective:1600px]">
                <div
                  ref={inspectPanelRef}
                  className={cn(
                    "home-spotlight-shell pointer-events-auto relative w-[min(92vw,38rem)] overflow-hidden rounded-[1.25rem] border transform-gpu",
                    "transition-[transform,opacity,filter] duration-[360ms] ease-[cubic-bezier(0.18,0.88,0.24,1)] will-change-[transform,opacity,filter]",
                    overlayPanelClass,
                  )}
                  style={{
                    transform: overlayPanelTransform,
                    transformOrigin: launchGeometry.origin,
                    opacity: overlayPhase === "closed" ? 0 : panelInFlight ? 0.78 : 1,
                    filter: panelInFlight ? "blur(6px) saturate(1.04)" : "blur(0px) saturate(1)",
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={closeInspect}
                    className={cn(
                      "absolute z-20 h-8 w-8 rounded-lg border transition-colors",
                      overlaySubpanelClass,
                    )}
                    style={{ top: 12, right: 12 }}
                    aria-label="Close quick inspect"
                  >
                    <X className="mx-auto h-4 w-4" />
                  </button>
                  <div className="relative max-h-[min(86vh,54rem)] overflow-y-auto hide-scrollbar p-4 sm:p-5">
                    <div className="relative pr-12">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className={cn("min-w-0 text-base font-semibold leading-tight sm:text-lg", isLight ? "text-s-90" : "text-slate-100")}>
                          {activeMarket.question}
                        </h3>
                        <div className={cn("flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em]", isLight ? "text-s-50" : "text-slate-400")}>
                          <span
                            className={cn(
                              "home-spotlight-card home-border-glow inline-flex items-center gap-1.5 rounded-full border px-2 py-1",
                              overlaySubpanelClass,
                              isLight ? "text-[#5673a4]" : "text-slate-200",
                            )}
                          >
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full",
                                activeMarket.acceptingOrders ? "bg-red-400 animate-pulse" : isLight ? "bg-slate-400" : "bg-slate-500",
                              )}
                              aria-hidden="true"
                            />
                            {activeMarket.acceptingOrders ? "Live" : "Watch"}
                          </span>
                          {selectedOutcome ? (
                            <span
                              className={cn(
                                "home-spotlight-card home-border-glow rounded-full border px-2 py-1",
                                getChanceToneClasses(selectedOutcomePrice, isLight),
                              )}
                            >
                              {Math.round(selectedOutcomePrice * 100)}% chance
                            </span>
                          ) : null}
                        </div>
                      </div>
                        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                          <div className={cn("rounded-sm border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em]", orbPillClass)}>
                            <span className={cn("block", isLight ? "text-s-50" : "text-slate-300/80")}>24h volume</span>
                            <span className={cn("mt-0.5 block text-[13px] font-semibold normal-case tracking-normal", isLight ? "text-s-90" : "text-slate-100")}>
                              {formatUsd(activeMarket.volume24hr || 0)}
                            </span>
                          </div>
                          <div className={cn("rounded-sm border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em]", orbPillClass)}>
                            <span className={cn("block", isLight ? "text-s-50" : "text-slate-300/80")}>Liquidity</span>
                            <span className={cn("mt-0.5 block text-[13px] font-semibold normal-case tracking-normal", isLight ? "text-s-90" : "text-slate-100")}>
                              {formatUsd(activeMarket.liquidity || 0)}
                            </span>
                          </div>
                          <div className={cn("rounded-sm border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em]", orbPillClass)}>
                            <span className={cn("block", isLight ? "text-s-50" : "text-slate-300/80")}>Market Opened</span>
                            <span className={cn("mt-0.5 block text-[13px] font-semibold normal-case tracking-normal", isLight ? "text-s-90" : "text-slate-100")}>
                              {marketOpenedAt || "Unavailable"}
                            </span>
                          </div>
                    </div>
                    </div>

                    <div className={cn("home-spotlight-card home-border-glow mt-4 rounded-2xl border p-3.5", overlaySubpanelClass)}>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {activeMarket.outcomes.slice(0, 2).map((outcome) => {
                          const price = outcome.price || outcome.lastTradePrice || 0
                          const isSelected = selectedOutcome?.index === outcome.index
                          const chanceToneClass = getChanceToneClasses(price, isLight)
                          const isPrimaryOutcome = outcome.index === 0
                          return (
                            <button
                              key={`${activeMarket.slug}-${outcome.index}-selector`}
                              type="button"
                              onClick={() => setSelectedOutcomeIndex(outcome.index)}
                              className={cn(
                                "home-spotlight-card home-border-glow flex min-h-[5.5rem] items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                                isSelected
                                  ? isPrimaryOutcome
                                    ? "border-emerald-300/35 bg-emerald-500/12"
                                    : outcome.index === 1
                                      ? "border-rose-300/35 bg-rose-500/12"
                                      : isLight
                                        ? "border-accent-30 bg-[#eef3fb]"
                                        : "border-accent-30 bg-accent-10"
                                  : isPrimaryOutcome
                                    ? isLight
                                      ? "border-emerald-300/35 bg-emerald-50/80"
                                      : "border-emerald-400/30 bg-emerald-500/10"
                                    : isLight
                                      ? "border-rose-300/35 bg-rose-50/80"
                                      : "border-rose-400/30 bg-rose-500/10",
                              )}
                            >
                              <div className="min-w-0">
                                <p className={cn("truncate text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{outcome.label}</p>
                                <p className={cn("mt-1 text-[11px]", isLight ? "text-s-50" : "text-slate-500")}>Buy at {formatCentPrice(price)} now</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-3">
                                <span className={cn("text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{Math.round(price * 100)}%</span>
                                <span
                                  className={cn(
                                    "rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
                                    chanceToneClass,
                                  )}
                                >
                                  {formatCentPrice(price)}
                                </span>
                              </div>
                            </button>
                          )
                        })}
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                        <label className="block">
                          <span className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-500")}>Spend (USDC)</span>
                          <input
                            value={quickAmount}
                            onChange={(event) => setQuickAmount(event.target.value)}
                            inputMode="decimal"
                            placeholder="e.g. 25"
                            className={cn(
                              "home-spotlight-card home-border-glow mt-2 h-11 w-full rounded-xl border px-3 text-base outline-none transition-colors placeholder:opacity-100",
                              isLight ? "border-[#d5dce8] bg-white text-s-90 placeholder:text-s-50" : "border-white/10 bg-black/25 text-white placeholder:text-slate-500 focus:border-white/20",
                            )}
                          />
                        </label>

                        <div className={cn("home-spotlight-card home-border-glow rounded-xl border px-3 py-2.5", overlaySubpanelClass)}>
                          <p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Route</p>
                          <p className={cn("mt-1 text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>
                            {selectedOutcome ? `${selectedOutcome.label} @ ${formatCentPrice(selectedOutcomePrice)}` : "--"}
                          </p>
                          <p className={cn("mt-1 text-[11px]", isLight ? "text-s-50" : "text-slate-500")}>Market order via Phantom</p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <div className={cn("home-spotlight-card home-border-glow rounded-xl border px-3 py-2.5", overlaySubpanelClass)}>
                          <p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Est. shares</p>
                          <p className={cn("mt-1 text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{formatShares(estimatedShares)}</p>
                        </div>
                        <div className={cn("home-spotlight-card home-border-glow rounded-xl border px-3 py-2.5", overlaySubpanelClass)}>
                          <p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Payout if right</p>
                          <p className={cn("mt-1 text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{formatUsd(estimatedPayout)}</p>
                        </div>
                        <div className={cn("home-spotlight-card home-border-glow rounded-xl border px-3 py-2.5", overlaySubpanelClass)}>
                          <p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Profit if right</p>
                          <p className={cn("mt-1 text-sm font-semibold", selectedOutcome?.index === 0 ? "text-emerald-300" : "text-rose-300")}>{formatUsd(estimatedProfit)}</p>
                        </div>
                      </div>

                      {!quickSettings.polymarket.connected || !quickSettings.polymarket.liveTradingEnabled ? (
                        <div className={cn("home-spotlight-card home-border-glow mt-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm", overlaySubpanelClass, isLight ? "text-s-70" : "text-slate-300")}>
                          <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                          <p>
                            {!quickSettings.polymarket.connected
                              ? "Connect your Polymarket wallet first to buy here."
                              : "Turn on live trading first before placing a quick buy from this panel."}
                          </p>
                        </div>
                      ) : null}

                      {tradeError ? <p className="mt-4 text-sm text-rose-300">{tradeError}</p> : null}
                      {tradeStatus ? <p className="mt-4 text-sm text-emerald-200">{tradeStatus}</p> : null}

                      <button
                        type="button"
                        onClick={() => void handleQuickBuy()}
                        disabled={submittingTrade || !selectedOutcome}
                        className={cn(
                          "home-spotlight-card home-border-glow mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
                          selectedOutcome?.index === 0
                            ? "border-emerald-300/30 bg-emerald-500/12 text-emerald-100 hover:bg-emerald-500/18"
                            : "border-rose-300/30 bg-rose-500/12 text-rose-100 hover:bg-rose-500/18",
                        )}
                      >
                        <CandlestickChart className="h-4 w-4" />
                        {submittingTrade ? "Submitting..." : "Place Order"}
                      </button>
                    </div>

                      <div className="mt-4 grid gap-3">
                      <div className={cn("home-spotlight-card home-border-glow rounded-2xl border p-3.5", overlaySubpanelClass)}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-500")}>Rules And Market Context</p>
                            <p className={cn("mt-1 text-xs", isLight ? "text-s-60" : "text-slate-400")}>Directly from the Polymarket market record.</p>
                          </div>
                          {detailLoading ? (
                            <span className={cn("rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.14em]", overlaySubpanelClass, isLight ? "text-[#5673a4]" : "text-slate-200")}>
                              Refreshing
                            </span>
                          ) : null}
                        </div>
                        {detailError ? <p className="mt-3 text-sm text-rose-300">{detailError}</p> : null}
                        <div className="mt-3 space-y-3">
                          {marketNarrative.sections.length > 0 ? marketNarrative.sections.map((section, sectionIndex) => (
                            <div key={`${section.title}-${sectionIndex}`} className={cn("home-spotlight-card home-border-glow rounded-xl border p-3", overlaySubpanelClass)}>
                              <p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-500")}>{section.title}</p>
                              <div className="mt-2 space-y-2">
                                {section.paragraphs.map((paragraph, paragraphIndex) => (
                                  <p key={`${section.title}-${sectionIndex}-${paragraphIndex}`} className={cn("text-sm leading-6", isLight ? "text-s-70" : "text-slate-300")}>
                                    {paragraph}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )) : (
                            <div className={cn("home-spotlight-card home-border-glow rounded-xl border p-3 text-sm leading-6", overlaySubpanelClass, isLight ? "text-s-70" : "text-slate-300")}>
                              Detailed market rules were not present in the upstream record for this market.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className={cn("home-spotlight-card home-border-glow rounded-xl border px-3 py-2.5", overlaySubpanelClass)}>
                          <p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Resolution Source</p>
                          <p className={cn("mt-1 text-sm leading-5", isLight ? "text-s-90" : "text-slate-100")}>{resolutionSourceLabel}</p>
                        </div>
                        <a
                          href={activeMarket.url}
                          target="_blank"
                          rel="noreferrer"
                          className={cn("home-spotlight-card home-border-glow rounded-xl border px-3 py-2.5 transition-colors", overlaySubpanelClass)}
                        >
                          <p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Polymarket</p>
                          <p className={cn("mt-1 inline-flex items-center gap-1 text-sm font-medium", isLight ? "text-s-90" : "text-slate-100")}>
                            Open market
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </p>
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  )
}
