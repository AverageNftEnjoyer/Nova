"use client"

import { createPortal } from "react-dom"
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { ArrowUpRight, BarChart2, CandlestickChart, ChevronDown, RefreshCw, Wallet, X } from "lucide-react"

import { useSpotlightEffect } from "@/app/integrations/hooks"
import { normalizePolymarketMarket, type PolymarketMarket, type PolymarketPricePoint } from "@/lib/integrations/polymarket/api"
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

interface LaunchOrigin { left: number; top: number; width: number; height: number }
interface InspectState { market: PolymarketMarket; origin: LaunchOrigin; launchId: number }
interface LaunchGeometry { transform: string; origin: string }
interface NarrativeSection { title: string; paragraphs: string[] }
interface ChartPoint { x: number; y: number; p: number; t: number }
type RangeId = "1h" | "6h" | "1d" | "1w" | "1m" | "all"

const RANGES: Array<{ id: RangeId; label: string }> = [
  { id: "1h", label: "1H" }, { id: "6h", label: "6H" }, { id: "1d", label: "1D" },
  { id: "1w", label: "1W" }, { id: "1m", label: "1M" }, { id: "all", label: "ALL" },
]

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const clampProb = (v: number) => clamp(Number.isFinite(v) ? v : 0.5, 0, 1)
const CHART_LEFT_PAD_PCT = 1.8
const CHART_RIGHT_PAD_PCT = 2.6
const CHART_TOP_PAD_PCT = 6
const CHART_BOTTOM_PAD_PCT = 8
const CHART_USABLE_X_PCT = 100 - CHART_LEFT_PAD_PCT - CHART_RIGHT_PAD_PCT
const CHART_USABLE_Y_PCT = 100 - CHART_TOP_PAD_PCT - CHART_BOTTOM_PAD_PCT
const usd = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v >= 100 ? 0 : 2 }).format(v)
const cents = (v: number) => `${Math.round(v * 100)}c`
const preciseCents = (v: number) => `${(clampProb(v) * 100).toFixed(2).replace(/\.?0+$/, "")}c`
const deltaPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v * 100).toFixed(1)}%`

function mapIndexToChartX(index: number, total: number): number {
  return CHART_LEFT_PAD_PCT + (index / Math.max(1, total - 1)) * CHART_USABLE_X_PCT
}

function mapPercentToChartY(percent: number, axisMinPercent: number, axisMaxPercent: number): number {
  const span = Math.max(axisMaxPercent - axisMinPercent, 1e-6)
  const normalized = clamp((percent - axisMinPercent) / span, 0, 1)
  return CHART_TOP_PAD_PCT + (1 - normalized) * CHART_USABLE_Y_PCT
}

function mapTimeToChartX(ts: number, minTs: number, maxTs: number): number {
  const span = Math.max(maxTs - minTs, 1)
  const normalized = clamp((ts - minTs) / span, 0, 1)
  return CHART_LEFT_PAD_PCT + normalized * CHART_USABLE_X_PCT
}

function formatDate(v: string): string {
  const p = Date.parse(String(v || "").trim())
  if (!Number.isFinite(p)) return ""
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(new Date(p))
}

function formatChartTime(ts: number, range: RangeId): string {
  if (!Number.isFinite(ts)) return ""
  const date = new Date(ts)
  const intraDay = range === "1h" || range === "6h" || range === "1d"
  return new Intl.DateTimeFormat("en-US", intraDay
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }
    : { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })
    .format(date)
}

function tone(chance: number, isLight: boolean): string {
  if (chance >= 0.75) return isLight ? "border-emerald-600/30 bg-emerald-100 text-emerald-900" : "border-emerald-400/40 bg-emerald-500/18 text-emerald-200"
  if (chance >= 0.5) return isLight ? "border-amber-400/40 bg-amber-100 text-amber-900" : "border-amber-300/40 bg-amber-500/18 text-amber-200"
  if (chance >= 0.25) return isLight ? "border-orange-400/40 bg-orange-100 text-orange-900" : "border-orange-300/40 bg-orange-500/18 text-orange-200"
  return isLight ? "border-rose-400/40 bg-rose-100 text-rose-900" : "border-rose-300/40 bg-rose-500/18 text-rose-200"
}

function fallbackSeries(base: number): PolymarketPricePoint[] {
  const b = clampProb(base)
  const now = Date.now()
  return Array.from({ length: 28 }, (_, i) => ({ t: now - (27 - i) * 60_000, p: clampProb(b + Math.sin(i / 3.8) * 0.018 + Math.cos(i / 6.2) * 0.009) }))
}

function buildChanceAxis(points: PolymarketPricePoint[]): { minPercent: number; maxPercent: number; ticks: number[] } {
  const source = points.length > 1 ? points : fallbackSeries(points[0]?.p ?? 0.5)
  const percents = source.map((point) => clampProb(point.p) * 100)
  const minObserved = Math.min(...percents)
  const maxObserved = Math.max(...percents)
  const rawSpan = Math.max(maxObserved - minObserved, 0)
  const pad = rawSpan < 2 ? 1 : Math.max(rawSpan * 0.22, 0.8)
  let minPercent = clamp(minObserved - pad, 0, 100)
  let maxPercent = clamp(maxObserved + pad, 0, 100)
  if (maxPercent - minPercent < 4) {
    const center = (minObserved + maxObserved) / 2
    minPercent = clamp(center - 2, 0, 96)
    maxPercent = clamp(minPercent + 4, 4, 100)
    minPercent = Math.max(0, maxPercent - 4)
  }
  const span = maxPercent - minPercent
  const step = span <= 6 ? 1 : span <= 12 ? 2 : span <= 25 ? 5 : span <= 60 ? 10 : 20
  minPercent = Math.floor(minPercent / step) * step
  maxPercent = Math.ceil(maxPercent / step) * step
  minPercent = clamp(minPercent, 0, 100)
  maxPercent = clamp(maxPercent, 0, 100)
  if (maxPercent <= minPercent) maxPercent = Math.min(100, minPercent + step)
  const ticks: number[] = []
  for (let value = minPercent; value <= maxPercent; value += step) ticks.push(value)
  return { minPercent, maxPercent, ticks }
}

function chartPaths(points: PolymarketPricePoint[], axisMinPercent: number, axisMaxPercent: number) {
  const s = points.length > 1 ? points : fallbackSeries(points[0]?.p ?? 0.5)
  const coords: ChartPoint[] = s.map((p, i) => ({
    x: mapIndexToChartX(i, s.length),
    y: mapPercentToChartY(clampProb(p.p) * 100, axisMinPercent, axisMaxPercent),
    p: clampProb(p.p),
    t: Number.isFinite(p.t) ? p.t : Date.now(),
  }))
  const line = coords.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")
  return {
    line,
    lastY: coords[coords.length - 1]?.y ?? 50,
    coords,
  }
}

function formatXAxisTick(ts: number, range: RangeId): string {
  if (!Number.isFinite(ts)) return ""
  const date = new Date(ts)
  if (range === "1h") {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(date)
  }
  if (range === "6h" || range === "1d") {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "America/New_York" }).format(date)
  }
  if (range === "1w" || range === "1m") {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(date)
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "America/New_York" }).format(date)
}

function stepMsForRange(range: RangeId, minTs: number, maxTs: number): number {
  const hour = 60 * 60 * 1000
  const day = 24 * hour
  if (range === "1h") return 10 * 60 * 1000
  if (range === "6h") return hour
  if (range === "1d") return 5 * hour
  if (range === "1w") return day
  if (range === "1m") return 5 * day
  const span = maxTs - minTs
  if (span <= 60 * day) return 7 * day
  if (span <= 365 * day) return 30 * day
  return 90 * day
}

function buildTimeAxisTicks(points: ChartPoint[], range: RangeId): Array<{ t: number; x: number; label: string }> {
  if (points.length < 2) return []
  const minTs = points[0]?.t ?? Number.NaN
  const maxTs = points[points.length - 1]?.t ?? Number.NaN
  if (!Number.isFinite(minTs) || !Number.isFinite(maxTs) || maxTs <= minTs) return []
  const step = Math.max(stepMsForRange(range, minTs, maxTs), 1)
  const ticks: Array<{ t: number; x: number; label: string }> = []
  let t = Math.ceil(minTs / step) * step
  for (; t <= maxTs; t += step) {
    ticks.push({ t, x: mapTimeToChartX(t, minTs, maxTs), label: formatXAxisTick(t, range) })
  }
  if (ticks.length === 0) {
    ticks.push({ t: minTs, x: mapTimeToChartX(minTs, minTs, maxTs), label: formatXAxisTick(minTs, range) })
  }
  return ticks
}

function parseNarrative(raw: string): { sections: NarrativeSection[]; openedAt: string } {
  const text = String(raw || "").replace(/\r/g, "").trim()
  if (!text) return { sections: [], openedAt: "" }
  const sections: NarrativeSection[] = []
  let current: NarrativeSection | null = null
  let openedAt = ""
  const heading = (line: string) => {
    const n = line.replace(/:$/, "").trim()
    return n.length > 0 && n.length <= 36 && !/[.!?]$/.test(n) && /^[A-Z][A-Za-z0-9/&' -]+$/.test(n)
  }
  const commit = () => { if (current && current.paragraphs.length > 0) sections.push(current); current = null }
  const ensure = () => { if (!current) current = { title: "Market Context", paragraphs: [] } }
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue
    let i = 0
    const heads: string[] = []
    while (i < lines.length && heading(lines[i])) { heads.push(lines[i].replace(/:$/, "").trim()); i += 1 }
    if (heads.length > 0) { commit(); current = { title: heads.join(" / "), paragraphs: [] } }
    if (i >= lines.length) continue
    ensure()
    const body = lines.slice(i).join(" ")
    const m = /^Market Opened:\s*(.+)$/i.exec(body)
    if (m) { openedAt = m[1].trim(); continue }
    current?.paragraphs.push(body)
  }
  commit()
  return { sections: sections.length > 0 ? sections : [{ title: "Market Context", paragraphs: [text] }], openedAt }
}

export function PolymarketLiveLinesModule({
  isLight, panelClass, subPanelClass, panelStyle, className, onOpenIntegrations, onOpenPolymarket,
}: PolymarketLiveLinesModuleProps) {
  const [markets, setMarkets] = useState<PolymarketMarket[]>([])
  const [inspect, setInspect] = useState<InspectState | null>(null)
  const [spotlightEnabled, setSpotlightEnabled] = useState(() => loadUserSettings().app.spotlightEnabled ?? true)
  const [portalReady, setPortalReady] = useState(false)
  const [phase, setPhase] = useState<"closed" | "measuring" | "open" | "closing">("closed")
  const [launch, setLaunch] = useState<LaunchGeometry>({ transform: "translate3d(0,24px,0) scale(0.94) rotateX(-3deg) rotateY(0deg)", origin: "50% 18%" })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [quickSettings, setQuickSettings] = useState<IntegrationsSettings>(() => loadIntegrationsSettings())
  const [outcomeIndex, setOutcomeIndex] = useState(0)
  const [amount, setAmount] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [tradeStatus, setTradeStatus] = useState("")
  const [tradeError, setTradeError] = useState("")
  const [range, setRange] = useState<RangeId>("1d")
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState("")
  const [historyPoints, setHistoryPoints] = useState<PolymarketPricePoint[]>([])
  const [chartCursorIndex, setChartCursorIndex] = useState<number | null>(null)
  const [chartDragging, setChartDragging] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const rafA = useRef<number | null>(null)
  const rafB = useRef<number | null>(null)
  const lastLaunchId = useRef(0)
  const launchId = useRef(0)
  const cacheRef = useRef<Map<string, PolymarketPricePoint[]>>(new Map())
  const pointerIdRef = useRef<number | null>(null)

  useEffect(() => {
    const sync = () => setSpotlightEnabled(loadUserSettings().app.spotlightEnabled ?? true)
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
  }, [])

  useSpotlightEffect(Boolean(inspect) && spotlightEnabled, [{ ref: panelRef, showSpotlightCore: false, enableParticles: false, directHoverOnly: true }], [Boolean(inspect), isLight, spotlightEnabled])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/polymarket/markets?tag=crypto&limit=8", { cache: "no-store", credentials: "include" })
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || !Array.isArray(data?.markets)) throw new Error(String(data?.error || "Failed to load Polymarket markets."))
        const next = data.markets
          .map((x: unknown) => normalizePolymarketMarket(x))
          .filter((x: PolymarketMarket | null): x is PolymarketMarket => Boolean(x))
          .slice(0, 8)
        setMarkets(next)
        setInspect((prev) => {
          if (!prev) return null
          const hit = next.find((m: PolymarketMarket) => m.slug === prev.market.slug)
          return hit ? { ...prev, market: hit } : null
        })
        setError("")
      })
      .catch((e) => { if (!cancelled) { setMarkets([]); setError(e instanceof Error ? e.message : "Failed to load Polymarket.") } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setPortalReady(true)
    return () => { if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current) }
  }, [])

  useEffect(() => {
    if (!inspect) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setPhase("closing") } }
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", onEsc)
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onEsc) }
  }, [inspect])

  useEffect(() => {
    const slug = inspect?.market.slug
    if (!slug) { setDetailLoading(false); setDetailError(""); return }
    let cancelled = false
    setDetailLoading(true); setDetailError("")
    fetch(`/api/polymarket/markets?slug=${encodeURIComponent(slug)}`, { cache: "no-store", credentials: "include" })
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || !data?.market) throw new Error(String(data?.error || "Failed to load market details."))
        const next = normalizePolymarketMarket(data.market)
        if (!next) throw new Error("Failed to normalize market details.")
        setInspect((prev) => (prev?.market.slug === slug ? { ...prev, market: next } : prev))
      })
      .catch((e) => { if (!cancelled) setDetailError(e instanceof Error ? e.message : "Failed to load market details.") })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [inspect?.market.slug])

  const inspectLaunchId = inspect?.launchId ?? 0
  const inspectOrigin = inspect?.origin ?? null
  const activeToken = inspect?.market.outcomes[outcomeIndex]?.tokenId || inspect?.market.outcomes[0]?.tokenId || ""
  useEffect(() => {
    if (!inspectLaunchId || !activeToken) { setHistoryLoading(false); setHistoryError(""); setHistoryPoints([]); return }
    const key = `${activeToken}:${range}`
    const cached = cacheRef.current.get(key)
    if (cached && cached.length > 0) { setHistoryPoints(cached); setHistoryLoading(false); setHistoryError(""); return }
    let cancelled = false
    setHistoryLoading(true); setHistoryError("")
    fetch(`/api/polymarket/history/${encodeURIComponent(activeToken)}?range=${range}`, { cache: "no-store", credentials: "include" })
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok) throw new Error(String(data?.error || "Failed to load chart history."))
        const points = Array.isArray(data?.points)
          ? data.points
            .map((x: unknown) => {
              const row = x && typeof x === "object" ? x as Record<string, unknown> : {}
              const t = Number(row.t); const p = Number(row.p)
              if (!Number.isFinite(t) || !Number.isFinite(p)) return null
              return { t: Math.trunc(t), p: clampProb(p) }
            })
            .filter((x: PolymarketPricePoint | null): x is PolymarketPricePoint => Boolean(x))
            .sort((a: PolymarketPricePoint, b: PolymarketPricePoint) => a.t - b.t)
          : []
        if (points.length > 0) { cacheRef.current.set(key, points); setHistoryPoints(points); setHistoryError("") }
        else { setHistoryPoints([]); setHistoryError("Live chart data unavailable. Showing fallback.") }
      })
      .catch((e) => { if (!cancelled) { setHistoryPoints([]); setHistoryError(e instanceof Error ? e.message : "Failed to load chart history.") } })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    return () => { cancelled = true }
  }, [inspectLaunchId, activeToken, range])

  useEffect(() => {
    if (phase !== "closing") return
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => { setInspect(null); setPhase("closed"); closeTimerRef.current = null }, 280)
    return () => { if (closeTimerRef.current) { window.clearTimeout(closeTimerRef.current); closeTimerRef.current = null } }
  }, [phase])

  useEffect(() => {
    setChartCursorIndex(null)
    setChartDragging(false)
    pointerIdRef.current = null
  }, [inspectLaunchId, activeToken, range, outcomeIndex])

  useLayoutEffect(() => {
    if (!portalReady || !inspectOrigin || !panelRef.current || !inspectLaunchId) return
    if (lastLaunchId.current === inspectLaunchId) return
    lastLaunchId.current = inspectLaunchId
    const panel = panelRef.current
    const o = inspectOrigin
    const r = panel.getBoundingClientRect()
    const ox = o.left + o.width / 2; const oy = o.top + o.height / 2
    const fx = r.left + r.width / 2; const fy = r.top + r.height / 2
    const tx = ox - fx; const ty = oy - fy
    const sx = clamp(o.width / Math.max(r.width, 1), 0.34, 1)
    const sy = clamp(o.height / Math.max(r.height, 1), 0.26, 1)
    const ry = clamp(tx / 42, -10, 10); const rx = clamp(-ty / 56, -8, 8)
    const opx = clamp(((ox - r.left) / Math.max(r.width, 1)) * 100, 18, 82)
    const opy = clamp(((oy - r.top) / Math.max(r.height, 1)) * 100, 16, 84)
    setLaunch({ transform: `translate3d(${tx}px, ${ty}px, 0) scale(${sx}, ${sy}) rotateX(${rx}deg) rotateY(${ry}deg)`, origin: `${opx}% ${opy}%` })
    setPhase("measuring")
    if (rafA.current) window.cancelAnimationFrame(rafA.current)
    if (rafB.current) window.cancelAnimationFrame(rafB.current)
    rafA.current = window.requestAnimationFrame(() => { rafB.current = window.requestAnimationFrame(() => setPhase((p) => (p === "closing" ? p : "open"))) })
    return () => {
      if (rafA.current) { window.cancelAnimationFrame(rafA.current); rafA.current = null }
      if (rafB.current) { window.cancelAnimationFrame(rafB.current); rafB.current = null }
    }
  }, [inspectLaunchId, inspectOrigin, portalReady])

  const getOutcomePrice = (market: PolymarketMarket, index: number): number => {
    const outcome = market.outcomes[index]
    if (!outcome) return 0
    return outcome.price || outcome.lastTradePrice || 0
  }

  const openInspect = (market: PolymarketMarket, element: HTMLButtonElement) => {
    if (closeTimerRef.current) { window.clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    const rect = element.getBoundingClientRect()
    setPhase("closed")
    setLaunch({ transform: "translate3d(0,24px,0) scale(0.94) rotateX(-3deg) rotateY(0deg)", origin: "50% 18%" })
    setOutcomeIndex(0); setAmount(""); setTradeStatus(""); setTradeError(""); setDetailError("")
    setRange("1d"); setHistoryLoading(false); setHistoryError(""); setHistoryPoints([]); setRulesOpen(false)
    setQuickSettings(loadIntegrationsSettings())
    launchId.current += 1
    setInspect({ market, origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, launchId: launchId.current })
  }

  const activeMarket = inspect?.market ?? null
  const selected = activeMarket?.outcomes.find((o) => o.index === outcomeIndex) || activeMarket?.outcomes[0] || null
  const selectedPrice = (selected?.bestAsk || selected?.price || selected?.lastTradePrice || 0) > 0 ? (selected?.bestAsk || selected?.price || selected?.lastTradePrice || 0) : 0
  const amountNum = Number.parseFloat(amount)
  const spend = Number.isFinite(amountNum) && amountNum > 0 ? amountNum : 0
  const shares = selected && spend > 0 && selectedPrice > 0 ? spend / selectedPrice : 0
  const payout = shares
  const profit = payout - spend
  const narrative = parseNarrative(activeMarket?.description || "")
  const openedAt = narrative.openedAt || formatDate(activeMarket?.createdAt || activeMarket?.startDate || "")
  const resolution = activeMarket?.resolutionSource || "Consensus of credible reporting."
  const series = historyPoints.length > 1 ? historyPoints : fallbackSeries(selectedPrice || 0.5)
  const axis = buildChanceAxis(series)
  const paths = chartPaths(series, axis.minPercent, axis.maxPercent)
  const firstP = paths.coords[0]?.p ?? selectedPrice
  const lastP = paths.coords[paths.coords.length - 1]?.p ?? selectedPrice
  const safeCursorIndex = chartCursorIndex === null ? null : clamp(chartCursorIndex, 0, Math.max(paths.coords.length - 1, 0))
  const cursorPoint = safeCursorIndex === null ? null : (paths.coords[safeCursorIndex] || null)
  const displayPoint = cursorPoint || paths.coords[paths.coords.length - 1] || null
  const displayP = displayPoint?.p ?? lastP
  const displayDelta = firstP > 0 ? (displayP - firstP) / firstP : 0
  const hoveredAt = cursorPoint ? formatChartTime(cursorPoint.t, range) : ""
  const tooltipX = clamp(cursorPoint?.x ?? 50, 8, 92)
  const xAxisTicks = buildTimeAxisTicks(paths.coords, range)
  const lineStroke = selected?.index === 1 ? (isLight ? "#ff4f78" : "#fecdd3") : (isLight ? "#16b98c" : "#86efac")
  const priceColor = selected?.index === 1 ? (isLight ? "text-rose-700" : "text-rose-300") : (isLight ? "text-emerald-700" : "text-emerald-300")
  const latestPoint = paths.coords[paths.coords.length - 1] || null
  const markerPoint = cursorPoint || latestPoint
  const liveBadgeX = clamp(latestPoint?.x ?? 50, 16, 84)
  const overlayVisible = phase === "open"
  const inFlight = phase === "measuring" || phase === "closing"
  const overlayPanel = cn(panelClass, "rounded-[1.25rem]", isLight ? "shadow-[0_24px_64px_-28px_rgba(140,152,174,0.34)]" : "shadow-[0_28px_84px_-34px_rgba(0,0,0,0.68)]")
  const overlaySub = cn(subPanelClass, "rounded-xl")
  const overlayTransform = phase === "open" ? "translate3d(0,0,0) scale(1) rotateX(0deg) rotateY(0deg)" : launch.transform
  const presets = [10, 25, 50, 100]
  const cta = submitting ? "Submitting..." : selected ? `Buy ${selected.label}${spend > 0 ? ` - ${usd(spend)}` : ""}` : "Select side"

  const setCursorFromClientX = (clientX: number) => {
    const rect = chartRef.current?.getBoundingClientRect()
    if (!rect || paths.coords.length === 0) return
    const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1)
    const normalized = clamp((ratio * 100 - CHART_LEFT_PAD_PCT) / Math.max(CHART_USABLE_X_PCT, 1e-6), 0, 1)
    setChartCursorIndex(Math.round(normalized * (paths.coords.length - 1)))
  }

  const handleChartPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (historyLoading || paths.coords.length === 0) return
    event.preventDefault()
    pointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    setChartDragging(true)
    setCursorFromClientX(event.clientX)
  }

  const handleChartPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (historyLoading || paths.coords.length === 0) return
    if (chartDragging || event.pointerType === "mouse") setCursorFromClientX(event.clientX)
  }

  const handleChartPointerEnter = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (historyLoading || paths.coords.length === 0) return
    if (event.pointerType === "mouse") setCursorFromClientX(event.clientX)
  }

  const handleChartPointerLeave = () => {
    if (!chartDragging) setChartCursorIndex(null)
  }

  const releaseChartPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    pointerIdRef.current = null
    setChartDragging(false)
  }

  const buy = async () => {
    if (!activeMarket || !selected) return void setTradeError("Select a side before placing a trade.")
    const latest = loadIntegrationsSettings(); setQuickSettings(latest)
    if (!latest.polymarket.connected) return void setTradeError("Connect your Polymarket wallet first.")
    if (!latest.polymarket.liveTradingEnabled) return void setTradeError("Enable live trading before placing orders.")
    if (!selected.tokenId) return void setTradeError("This market is missing a tradable token.")
    if (!Number.isFinite(amountNum) || amountNum <= 0) return void setTradeError("Enter a spend amount greater than zero.")
    setSubmitting(true); setTradeError(""); setTradeStatus("")
    try {
      const trader = await createPolymarketBrowserTrader({ walletAddress: latest.polymarket.walletAddress, profileAddress: latest.polymarket.profileAddress })
      const res = await trader.submitBuyOrder({ tokenId: selected.tokenId, amountUsd: amountNum, tickSize: activeMarket.orderPriceMinTickSize, negRisk: activeMarket.negRisk })
      const orderId = typeof (res as { orderID?: unknown })?.orderID === "string" ? ` Order ID ${(res as { orderID: string }).orderID}.` : ""
      setTradeStatus(`Buy order sent for ${selected.label}.${orderId}`)
    } catch (e) {
      setTradeError(e instanceof Error ? e.message : "Failed to submit live trade.")
    } finally {
      setSubmitting(false)
    }
  }

  const closeInspect = () => setPhase("closing")

  return (
    <section style={panelStyle} className={cn(`${panelClass} home-spotlight-shell h-[clamp(15rem,30vh,18.5rem)] px-3 pb-2 pt-2.5 flex flex-col`, className)}>
      <div className="relative flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-s-80"><BarChart2 className="h-4 w-4 text-accent" /></div>
        <h2 className={cn("absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-semibold uppercase tracking-[0.22em]", isLight ? "text-s-90" : "text-slate-200")}>Polymarket</h2>
        <div className="flex items-center gap-1">
          <button onClick={onOpenIntegrations} className={cn("home-spotlight-card home-border-glow home-spotlight-card--hover h-7 rounded-md border px-2 text-[10px] uppercase tracking-[0.12em] transition-colors", subPanelClass)}>Setup</button>
          <button onClick={onOpenPolymarket} className={cn("home-spotlight-card home-border-glow home-spotlight-card--hover inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] uppercase tracking-[0.12em] transition-colors", subPanelClass)}>Trade<ArrowUpRight className="h-3 w-3" /></button>
        </div>
      </div>

      <div className="mt-2 min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-400"><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />Loading live markets...</div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-rose-300">{error}</div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-2 auto-rows-fr gap-1.5">
            {markets.map((market) => (
              <button key={market.slug} type="button" onClick={(e) => openInspect(market, e.currentTarget)} className={cn("home-spotlight-card home-border-glow min-w-0 h-full rounded-md border px-1.5 py-1 text-left transition hover:-translate-y-px flex flex-col justify-between", isLight ? "border-[#cdd9ea] bg-[#edf2fb]" : "home-subpanel-surface")}>
                <div className="flex items-center justify-between gap-1">
                  <p className={cn("line-clamp-1 min-w-0 text-[10px] font-semibold leading-tight", isLight ? "text-s-80" : "text-slate-200")}>{market.question}</p>
                  <span className={cn("shrink-0 text-[8px] uppercase tracking-[0.06em]", isLight ? "text-s-50" : "text-slate-400")}>{market.acceptingOrders ? "Live" : "Watch"}</span>
                </div>
                <div className="mt-1 space-y-1">
                  <div className="overflow-hidden rounded-full border border-white/8"><div className="flex h-1.5 w-full"><div className="bg-emerald-400/90" style={{ width: `${Math.max(0, Math.min(100, getOutcomePrice(market, 0) * 100))}%` }} /><div className="bg-rose-400/90" style={{ width: `${Math.max(0, Math.min(100, getOutcomePrice(market, 1) * 100))}%` }} /></div></div>
                  <div className="flex items-center justify-center gap-3 text-[10px] leading-none">
                    {market.outcomes.slice(0, 2).map((outcome) => (
                      <div key={`${market.slug}-${outcome.index}`} className="inline-flex min-w-0 items-center gap-1.5">
                        <span className={cn("truncate font-medium", isLight ? "text-s-60" : "text-slate-300", outcome.index === 0 ? "text-emerald-300" : outcome.index === 1 ? "text-rose-300" : "")}>{outcome.label}</span>
                        <span className={cn("shrink-0 font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{Math.round((outcome.price || outcome.lastTradePrice || 0) * 100)}c</span>
                      </div>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {portalReady && activeMarket ? createPortal(
        <div className="fixed inset-0 z-[140]" style={panelStyle}>
          <button type="button" aria-label="Close quick inspect" onClick={closeInspect} className="absolute inset-0 bg-black/56 transition-opacity duration-280" style={{ opacity: overlayVisible ? 1 : 0 }} />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3 sm:p-6 [perspective:1600px]">
            <div ref={panelRef} className={cn("home-spotlight-shell pointer-events-auto relative w-[min(96vw,72rem)] overflow-hidden rounded-[1.25rem] border transform-gpu", "transition-[transform,opacity,filter] duration-[360ms] ease-[cubic-bezier(0.18,0.88,0.24,1)] will-change-[transform,opacity,filter]", overlayPanel)} style={{ transform: overlayTransform, transformOrigin: launch.origin, opacity: phase === "closed" ? 0 : inFlight ? 0.78 : 1, filter: inFlight ? "blur(6px) saturate(1.04)" : "blur(0px) saturate(1)" }} onClick={(e) => e.stopPropagation()}>
              <div className="relative max-h-[min(88vh,56rem)] overflow-y-auto hide-scrollbar">
                <div className={cn("px-4 pb-3 pt-3.5 sm:px-5 border-b", isLight ? "border-[#d5dce8]" : "border-white/10")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className={cn("min-w-0 truncate text-lg font-semibold leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{activeMarket.question}</h3>
                      <span className={cn("home-spotlight-card home-border-glow inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em]", overlaySub)}><span className={cn("h-2 w-2 rounded-full", activeMarket.acceptingOrders ? "animate-pulse bg-red-400" : isLight ? "bg-slate-400" : "bg-slate-500")} aria-hidden="true" />{activeMarket.acceptingOrders ? "Live" : "Watch"}</span>
                      {selected ? <span className={cn("home-spotlight-card home-border-glow shrink-0 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em]", tone(selectedPrice, isLight))}>{Math.round(selectedPrice * 100)}%</span> : null}
                    </div>
                    <button
                      type="button"
                      onClick={closeInspect}
                      className={cn(overlaySub, "home-spotlight-card home-border-glow home-spotlight-card--hover inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors", isLight ? "text-s-70 hover:text-s-90" : "text-slate-300 hover:text-slate-100")}
                      aria-label="Close quick inspect"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className={cn("grid gap-0 lg:grid-cols-[minmax(0,1fr)_18.75rem]", isLight ? "bg-white/35" : "bg-black/10")}>
                  <div className={cn("border-b p-4 sm:p-5 lg:border-b-0 lg:border-r", isLight ? "border-[#d5dce8]" : "border-white/10")}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-end gap-2"><p className={cn("text-4xl font-semibold leading-none tracking-tight", priceColor)}>{Math.round(displayP * 100)}c</p><p className={cn("pb-1 text-sm font-semibold", displayDelta > 0 ? isLight ? "text-emerald-700" : "text-emerald-300" : displayDelta < 0 ? isLight ? "text-rose-700" : "text-rose-300" : isLight ? "text-s-60" : "text-slate-400")}>{deltaPct(displayDelta)}</p></div>
                      <div className="flex flex-wrap items-center gap-1">{RANGES.map((r) => <button key={r.id} type="button" onClick={() => setRange(r.id)} className={cn("rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors", range === r.id ? isLight ? "bg-[#dce6f6] text-s-90" : "bg-white/14 text-slate-100" : isLight ? "text-s-50 hover:bg-[#e8eef8]" : "text-slate-500 hover:bg-white/8 hover:text-slate-200")}>{r.label}</button>)}</div>
                    </div>
                    <div className={cn("home-spotlight-card home-border-glow relative mt-4 h-56 overflow-hidden rounded-xl border", overlaySub)}>
                      {historyLoading ? (
                        <div className={cn("h-full w-full animate-pulse", isLight ? "bg-[#eef3fb]" : "bg-white/5")} />
                      ) : (
                        <div className="grid h-full w-full grid-cols-[minmax(0,1fr)_3rem] grid-rows-[minmax(0,1fr)_0.95rem]">
                          <div
                            ref={chartRef}
                            className="relative h-full w-full touch-none cursor-crosshair"
                            onPointerDown={handleChartPointerDown}
                            onPointerMove={handleChartPointerMove}
                            onPointerEnter={handleChartPointerEnter}
                            onPointerLeave={handleChartPointerLeave}
                            onPointerUp={releaseChartPointer}
                            onPointerCancel={releaseChartPointer}
                          >
                            <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="none">
                              {axis.ticks.map((tick) => {
                                const y = mapPercentToChartY(tick, axis.minPercent, axis.maxPercent).toFixed(2)
                                return <line key={`grid-${tick}`} x1="0" y1={y} x2="100" y2={y} stroke={isLight ? "rgba(70,89,122,0.08)" : "rgba(255,255,255,0.08)"} strokeWidth="0.22" strokeDasharray="0.54 0.44" strokeLinecap="round" />
                              })}
                              <path d={paths.line} fill="none" stroke={lineStroke} strokeOpacity="0.42" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                              <path d={paths.line} fill="none" stroke={lineStroke} strokeWidth="0.38" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                            </svg>
                            {!cursorPoint && latestPoint ? (
                              <div className="pointer-events-none absolute top-2 z-[2] -translate-x-1/2" style={{ left: `${liveBadgeX}%` }}>
                                <div className={cn("rounded-md border px-2 py-1 text-[10px] font-semibold backdrop-blur-[1px]", isLight ? "border-[#c9d6e8] bg-white/88 text-s-90" : "border-white/15 bg-[#0b0f18]/86 text-slate-100")}>
                                  <span>{preciseCents(latestPoint.p)}</span>
                                  <span className={cn("ml-1.5 font-medium", isLight ? "text-s-60" : "text-slate-400")}>{formatChartTime(latestPoint.t, range)}</span>
                                </div>
                              </div>
                            ) : null}
                            {markerPoint ? (
                              <div
                                className={cn("pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full", !cursorPoint && "animate-pulse")}
                                style={{
                                  left: `${markerPoint.x}%`,
                                  top: `${markerPoint.y}%`,
                                  backgroundColor: lineStroke,
                                  boxShadow: `0 0 0 1px ${lineStroke}, 0 0 6px ${lineStroke}66`,
                                }}
                              />
                            ) : null}
                            {cursorPoint ? (
                              <>
                                <div
                                  className={cn("pointer-events-none absolute inset-y-0 border-l", isLight ? "border-slate-500/40" : "border-white/34")}
                                  style={{ left: `${cursorPoint.x}%` }}
                                />
                                <div className="pointer-events-none absolute top-2 z-[2] -translate-x-1/2" style={{ left: `${tooltipX}%` }}>
                                  <div className={cn(overlaySub, "rounded-md border px-2 py-1 text-[10px] font-semibold", isLight ? "text-s-90" : "text-slate-100")}>
                                    <span>{preciseCents(cursorPoint.p)}</span>
                                    {hoveredAt ? <span className={cn("ml-1.5 font-medium", isLight ? "text-s-60" : "text-slate-400")}>{hoveredAt}</span> : null}
                                  </div>
                                </div>
                              </>
                            ) : null}
                          </div>
                          <div className={cn("pointer-events-none relative row-start-1 col-start-2 h-full pb-0.5 pl-0.5 pr-0 text-[10px]", isLight ? "text-s-70" : "text-white")}>
                            {axis.ticks.map((tick) => {
                              const y = clamp(mapPercentToChartY(tick, axis.minPercent, axis.maxPercent), 8, 92)
                              const transform = "translateY(-50%)"
                              return <span key={`axis-${tick}`} className="absolute left-0 whitespace-nowrap leading-none" style={{ top: `${y}%`, transform }}>{tick}%</span>
                            })}
                          </div>
                          <div className={cn("pointer-events-none relative row-start-2 col-start-1 h-full text-[10px]", isLight ? "text-s-70" : "text-white")}>
                            {xAxisTicks.map((tick, index) => {
                              const transform = index === 0 ? "translateX(0)" : index === xAxisTicks.length - 1 ? "translateX(-100%)" : "translateX(-50%)"
                              return <span key={`xtick-${tick.t}-${index}`} className="absolute top-0 truncate leading-4" style={{ left: `${tick.x}%`, transform }}>{tick.label}</span>
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    {historyError ? <p className={cn("mt-2 text-xs", isLight ? "text-amber-700" : "text-amber-300")}>{historyError}</p> : null}
                    <div className={cn("mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}><span>Vol 24h <strong className={cn("font-semibold normal-case tracking-normal", isLight ? "text-s-90" : "text-slate-200")}>{usd(activeMarket.volume24hr || 0)}</strong></span><span>Liquidity <strong className={cn("font-semibold normal-case tracking-normal", isLight ? "text-s-90" : "text-slate-200")}>{usd(activeMarket.liquidity || 0)}</strong></span><span>Opened <strong className={cn("font-semibold normal-case tracking-normal", isLight ? "text-s-90" : "text-slate-200")}>{openedAt || "Unavailable"}</strong></span></div>
                    <div className="mt-4"><p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-500")}>Resolution Source</p><p className={cn("mt-1 text-sm leading-6", isLight ? "text-s-70" : "text-slate-300")}>{resolution}</p></div>
                    <div className={cn("home-spotlight-card home-border-glow mt-4 overflow-hidden rounded-xl border", overlaySub)}>
                      <button type="button" onClick={() => setRulesOpen((p) => !p)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"><div><p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-500")}>Rules And Market Context</p><p className={cn("mt-1 text-xs", isLight ? "text-s-60" : "text-slate-400")}>Directly from Polymarket.</p></div><div className="flex items-center gap-2">{detailLoading ? <span className={cn("text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-400")}>Refreshing</span> : null}<ChevronDown className={cn("h-4 w-4 transition-transform", rulesOpen ? "rotate-180" : "rotate-0")} /></div></button>
                      {detailError ? <p className={cn("border-t px-3 py-2 text-xs", isLight ? "border-[#d5dce8] text-rose-700" : "border-white/10 text-rose-300")}>{detailError}</p> : null}
                      {rulesOpen ? <div className={cn("space-y-3 border-t p-3", isLight ? "border-[#d5dce8]" : "border-white/10")}>{narrative.sections.length > 0 ? narrative.sections.map((s, i) => <div key={`${s.title}-${i}`} className={cn("rounded-lg border p-2.5", overlaySub)}><p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>{s.title}</p><div className="mt-1.5 space-y-1.5">{s.paragraphs.map((p, j) => <p key={`${s.title}-${i}-${j}`} className={cn("text-sm leading-6", isLight ? "text-s-70" : "text-slate-300")}>{p}</p>)}</div></div>) : <p className={cn("text-sm leading-6", isLight ? "text-s-70" : "text-slate-300")}>Detailed market rules were not present in the upstream record for this market.</p>}<a href={activeMarket.url} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 text-xs font-medium", isLight ? "text-s-70 hover:text-s-90" : "text-slate-300 hover:text-slate-100")}>Open on Polymarket<ArrowUpRight className="h-3.5 w-3.5" /></a></div> : null}
                    </div>
                  </div>
                  <div className="p-4 sm:p-5">
                    <div className="grid grid-cols-2 gap-2">{activeMarket.outcomes.slice(0, 2).map((o) => { const p = o.price || o.lastTradePrice || 0; const selectedCard = selected?.index === o.index; const yes = o.index === 0; return <button key={`${activeMarket.slug}-${o.index}-selector`} type="button" onClick={() => setOutcomeIndex(o.index)} className={cn("home-spotlight-card home-border-glow rounded-xl border px-3 py-2.5 text-left transition-colors", yes ? selectedCard ? isLight ? "border-emerald-500/45 bg-emerald-100" : "border-emerald-300/55 bg-emerald-500/18" : isLight ? "border-emerald-400/30 bg-emerald-50/85" : "border-emerald-400/30 bg-emerald-500/10" : selectedCard ? isLight ? "border-rose-500/45 bg-rose-100" : "border-rose-300/55 bg-rose-500/18" : isLight ? "border-rose-400/30 bg-rose-50/85" : "border-rose-400/30 bg-rose-500/10")}><p className={cn("text-2xl font-semibold leading-none", isLight ? "text-s-90" : "text-slate-100")}>{o.label}</p><p className={cn("mt-1 text-xs", isLight ? "text-s-50" : "text-slate-400")}>Buy</p><div className="mt-1 flex items-center justify-between gap-2"><span className={cn("text-2xl font-semibold", yes ? "text-emerald-300" : "text-rose-300")}>{Math.round(p * 100)}%</span><span className={cn("rounded-md px-1.5 py-1 text-[10px] font-semibold", yes ? "bg-emerald-500/18 text-emerald-200" : "bg-rose-500/18 text-rose-200")}>{cents(p)}</span></div><p className={cn("mt-1 text-xs", isLight ? "text-s-50" : "text-slate-400")}>{cents(p)} now</p></button> })}</div>
                    <div className="mt-4"><div className="flex items-center justify-between"><p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-500")}>Amount</p><p className={cn("text-[10px]", isLight ? "text-s-50" : "text-slate-500")}>Min {usd(activeMarket.orderMinSize || 0)}</p></div><label className={cn("home-spotlight-card home-border-glow mt-2 flex h-11 items-center rounded-xl border px-3", overlaySub)}><span className={cn("mr-2 text-sm", isLight ? "text-s-50" : "text-slate-500")}>$</span><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="25" className={cn("h-full w-full bg-transparent text-base outline-none placeholder:opacity-100", isLight ? "text-s-90 placeholder:text-s-50" : "text-white placeholder:text-slate-500")} /></label><div className="mt-2 grid grid-cols-4 gap-1.5">{presets.map((p) => <button key={p} type="button" onClick={() => setAmount(String(p))} className={cn("rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors", Number.parseFloat(amount) === p ? isLight ? "border-emerald-500/45 bg-emerald-100 text-emerald-900" : "border-emerald-400/45 bg-emerald-500/18 text-emerald-200" : isLight ? "border-[#d5dce8] text-s-60 hover:bg-[#edf2fb]" : "border-white/10 text-slate-400 hover:bg-white/8 hover:text-slate-200")}>${p}</button>)}</div></div>
                    <div className={cn("home-spotlight-card home-border-glow mt-3 rounded-xl border px-3 py-2.5", overlaySub)}><div className="flex items-center justify-between gap-2 text-sm"><span className={cn(isLight ? "text-s-60" : "text-slate-400")}>Shares</span><span className={cn("font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{shares.toFixed(2)}</span></div><div className="mt-1.5 flex items-center justify-between gap-2 text-sm"><span className={cn(isLight ? "text-s-60" : "text-slate-400")}>Potential payout</span><span className={cn("font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{usd(payout)}</span></div><div className="mt-1.5 flex items-center justify-between gap-2 text-sm"><span className={cn(isLight ? "text-s-60" : "text-slate-400")}>Profit</span><span className={cn("font-semibold", profit >= 0 ? "text-emerald-300" : "text-rose-300")}>{profit >= 0 ? "+" : "-"}{usd(Math.abs(profit))}</span></div></div>
                    {!quickSettings.polymarket.connected || !quickSettings.polymarket.liveTradingEnabled ? <div className={cn("home-spotlight-card home-border-glow mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm", overlaySub, isLight ? "text-s-70" : "text-slate-300")}><Wallet className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><p>{!quickSettings.polymarket.connected ? "Connect your Polymarket wallet first to buy here." : "Turn on live trading before placing a quick buy from this panel."}</p></div> : null}
                    {tradeError ? <p className="mt-3 text-sm text-rose-300">{tradeError}</p> : null}
                    {tradeStatus ? <p className="mt-3 text-sm text-emerald-200">{tradeStatus}</p> : null}
                    <button type="button" onClick={() => void buy()} disabled={submitting || !selected} className={cn("home-spotlight-card home-border-glow mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60", selected?.index === 1 ? "border-rose-300/35 bg-rose-500/16 text-rose-100 hover:bg-rose-500/22" : "border-emerald-300/35 bg-emerald-500/18 text-emerald-100 hover:bg-emerald-500/24")}><CandlestickChart className="h-4 w-4" />{cta}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </section>
  )
}
