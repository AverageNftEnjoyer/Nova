"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { Settings2, Wallet } from "lucide-react"

import { PageContainer } from "@/components/shell"
import { Badge, Button, EmptyState, PageHeader, Panel, SkeletonRows, toast, type SelectOption } from "@/components/ui"
import {
  normalizePolymarketLeaderboardEntry,
  normalizePolymarketMarket,
  normalizePolymarketOrderBook,
  type PolymarketLeaderboardEntry,
  type PolymarketMarket,
  type PolymarketOrderBook,
  type PolymarketPosition,
  type PolymarketPricePoint,
} from "@/lib/integrations/polymarket/api"
import { connectPolymarketWallet, createPolymarketBrowserTrader } from "@/lib/integrations/polymarket/browser"
import { normalizePolymarketIntegrationConfig } from "@/lib/integrations/polymarket/types"
import { getGlobalPolymarketWsManager, type PolymarketWsPriceUpdate } from "@/lib/integrations/polymarket/ws"
import { loadIntegrationsSettings, saveIntegrationsSettings, type IntegrationsSettings } from "@/lib/integrations/store/client-store"

import { LeaderboardTable, type LeaderboardWindow } from "./leaderboard-table"
import { LiveLines } from "./live-lines"
import { MarketDetail } from "./market-detail"
import { MarketSearch } from "./market-search"
import { MarketTable } from "./market-table"
import { MarketTicker } from "./market-ticker"
import { OrderBookVisual } from "./orderbook-visual"
import { PortfolioPanel } from "./portfolio-panel"
import { PriceChart, type PriceChartRange } from "./price-chart"
import { TradeTicket, type OrderAction } from "./trade-ticket"
import { clamp01, formatAddress } from "../lib/format"

const SETUP_HREF = "/integrations?setup=polymarket"

function applyLivePriceUpdateToMarket(market: PolymarketMarket, update: PolymarketWsPriceUpdate): PolymarketMarket {
  let changed = false
  const finite = (value: number | undefined | null): value is number => Number.isFinite(value as number)
  const outcomes = market.outcomes.map((outcome) => {
    if (String(outcome.tokenId || "").trim() !== update.tokenId) return outcome
    const nextBid = finite(update.bid) ? clamp01(Number(update.bid)) : outcome.bestBid
    const nextAsk = finite(update.ask) ? clamp01(Number(update.ask)) : outcome.bestAsk
    const nextLastTradePrice = finite(update.lastTradePrice)
      ? clamp01(Number(update.lastTradePrice))
      : finite(update.midpoint)
        ? clamp01(Number(update.midpoint))
        : outcome.lastTradePrice
    const nextPrice = finite(update.lastTradePrice)
      ? clamp01(Number(update.lastTradePrice))
      : finite(update.midpoint)
        ? clamp01(Number(update.midpoint))
        : finite(update.bid)
          ? clamp01(Number(update.bid))
          : finite(update.ask)
            ? clamp01(Number(update.ask))
            : outcome.price
    if (nextBid === outcome.bestBid && nextAsk === outcome.bestAsk && nextLastTradePrice === outcome.lastTradePrice && nextPrice === outcome.price) {
      return outcome
    }
    changed = true
    return { ...outcome, bestBid: nextBid, bestAsk: nextAsk, lastTradePrice: nextLastTradePrice, price: nextPrice }
  })
  return changed ? { ...market, outcomes } : market
}

function applyPolymarketConfig(prev: IntegrationsSettings, nextPolymarket: IntegrationsSettings["polymarket"]): IntegrationsSettings {
  const next = { ...prev, polymarket: normalizePolymarketIntegrationConfig(nextPolymarket) }
  saveIntegrationsSettings(next)
  return next
}

type MarketSortMode = "volume24hr" | "liquidity" | "newest" | "endingSoon"

const MARKET_PAGE_SIZE = 12

const MARKET_BASE_TAGS: SelectOption[] = [
  { value: "all", label: "All tags" },
  { value: "crypto", label: "Crypto" },
  { value: "politics", label: "Politics" },
  { value: "sports", label: "Sports" },
  { value: "business", label: "Business" },
]

const MARKET_SORT_OPTIONS: SelectOption[] = [
  { value: "volume24hr", label: "Volume 24h" },
  { value: "liquidity", label: "Liquidity" },
  { value: "newest", label: "Newest" },
  { value: "endingSoon", label: "Ending soon" },
]

const MARKET_SORT_TO_QUERY: Record<MarketSortMode, string> = {
  volume24hr: "volume24hr",
  liquidity: "liquidity",
  newest: "createdAt",
  endingSoon: "endDate",
}

const MARKET_SORT_ASCENDING: Partial<Record<MarketSortMode, boolean>> = { endingSoon: true }

async function readJson(res: Response): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, data }
}

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

export function PolymarketScreen() {
  const searchParams = useSearchParams()
  const feedLoadMoreRef = useRef<HTMLDivElement | null>(null)
  const marketLoadLockRef = useRef(false)
  const marketFeedQueryKeyRef = useRef("")

  const [settings, setSettings] = useState<IntegrationsSettings>(() => loadIntegrationsSettings())
  const [markets, setMarkets] = useState<PolymarketMarket[]>([])
  const [selectedMarket, setSelectedMarket] = useState<PolymarketMarket | null>(null)
  const [positions, setPositions] = useState<PolymarketPosition[]>([])
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [selectedTag, setSelectedTag] = useState("crypto")
  const [marketSortMode, setMarketSortMode] = useState<MarketSortMode>("volume24hr")
  const [marketOffset, setMarketOffset] = useState(0)
  const [hasMoreMarkets, setHasMoreMarkets] = useState(true)
  const [loadingMarkets, setLoadingMarkets] = useState(false)
  const [loadingMoreMarkets, setLoadingMoreMarkets] = useState(false)
  const [marketsError, setMarketsError] = useState("")
  const [loadingPortfolio, setLoadingPortfolio] = useState(false)
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [submittingTrade, setSubmittingTrade] = useState(false)
  const [savePending, setSavePending] = useState(false)
  const [activityError, setActivityError] = useState("")
  const [orderAction, setOrderAction] = useState<OrderAction>("buy")
  const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState(0)
  const [amount, setAmount] = useState("25")
  const [openOrders, setOpenOrders] = useState<unknown[]>([])
  const [recentTrades, setRecentTrades] = useState<unknown[]>([])
  const [orderBook, setOrderBook] = useState<PolymarketOrderBook | null>(null)
  const [loadingOrderBook, setLoadingOrderBook] = useState(false)
  const [orderBookError, setOrderBookError] = useState("")
  const [leaderboardWindow, setLeaderboardWindow] = useState<LeaderboardWindow>("day")
  const [leaderboardEntries, setLeaderboardEntries] = useState<PolymarketLeaderboardEntry[]>([])
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false)
  const [leaderboardError, setLeaderboardError] = useState("")
  const [historyRange, setHistoryRange] = useState<PriceChartRange>("1d")
  const [historyPoints, setHistoryPoints] = useState<PolymarketPricePoint[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState("")
  const requestedSlug = String(searchParams.get("slug") || "").trim()
  const requestedOutcome = String(searchParams.get("outcome") || "").trim().toLowerCase()
  const requestedSide = String(searchParams.get("side") || "").trim().toLowerCase()

  const connected = Boolean(settings.polymarket.connected)
  const liveTradingEnabled = Boolean(settings.polymarket.liveTradingEnabled)
  const selectedOutcome = selectedMarket?.outcomes[selectedOutcomeIndex] || selectedMarket?.outcomes[0] || null
  const rawPrice = selectedOutcome?.bestAsk || selectedOutcome?.price || selectedOutcome?.lastTradePrice || 0
  const selectedOutcomePrice = rawPrice > 0 ? rawPrice : 0
  const selectedTokenId = String(selectedOutcome?.tokenId || "").trim()
  const marketFeedQueryKey = `${deferredSearch.trim().toLowerCase()}|${selectedTag}|${marketSortMode}`
  const numericAmount = Number.parseFloat(amount)

  const marketTagOptions = useMemo<SelectOption[]>(() => {
    const options = new Map<string, string>()
    for (const entry of MARKET_BASE_TAGS) options.set(entry.value, entry.label)
    for (const market of markets) {
      for (const tag of market.tags) {
        const value = String(tag.slug || "").trim().toLowerCase()
        const label = String(tag.label || "").trim()
        if (!value || !label || options.has(value)) continue
        options.set(value, label)
      }
    }
    const [all, ...rest] = [...options.entries()].map(([value, label]) => ({ value, label }))
    return [all, ...rest.sort((a, b) => a.label.localeCompare(b.label))]
  }, [markets])

  // Keep the cached Polymarket config in sync with the server (another window may have connected a wallet).
  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      try {
        const res = await fetch("/api/integrations/config", { cache: "no-store" })
        const data = (await res.json()) as { config?: IntegrationsSettings }
        if (cancelled || !res.ok || !data.config) return
        setSettings((prev) => applyPolymarketConfig(prev, data.config!.polymarket))
      } catch {
        // Keep the local cache when the server is unreachable.
      }
    }
    void sync()
    const onFocus = () => void sync()
    const onVisibility = () => {
      if (document.visibilityState === "visible") void sync()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      cancelled = true
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  useEffect(() => {
    if (marketFeedQueryKeyRef.current !== marketFeedQueryKey) {
      marketFeedQueryKeyRef.current = marketFeedQueryKey
      marketLoadLockRef.current = false
      setHasMoreMarkets(true)
      if (marketOffset !== 0) {
        setMarketOffset(0)
        return
      }
    }

    let cancelled = false
    const initialChunk = marketOffset === 0
    if (initialChunk) {
      setLoadingMarkets(true)
      setLoadingMoreMarkets(false)
    } else {
      setLoadingMoreMarkets(true)
    }
    setMarketsError("")

    const url = new URL("/api/polymarket/markets", window.location.origin)
    url.searchParams.set("limit", String(MARKET_PAGE_SIZE))
    if (marketOffset > 0) url.searchParams.set("offset", String(marketOffset))
    const normalizedSearch = deferredSearch.trim()
    if (normalizedSearch) url.searchParams.set("q", normalizedSearch)
    else if (selectedTag !== "all") url.searchParams.set("tag", selectedTag)
    url.searchParams.set("sort", MARKET_SORT_TO_QUERY[marketSortMode])
    const ascending = MARKET_SORT_ASCENDING[marketSortMode]
    if (typeof ascending === "boolean") url.searchParams.set("ascending", ascending ? "true" : "false")

    fetch(url.toString(), { cache: "no-store" })
      .then(readJson)
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || !Array.isArray(data.markets)) throw new Error(String(data.error || "Could not load Polymarket markets."))
        const nextChunk = (data.markets as unknown[])
          .map((entry) => normalizePolymarketMarket(entry))
          .filter((entry): entry is PolymarketMarket => Boolean(entry))
        setHasMoreMarkets(nextChunk.length >= MARKET_PAGE_SIZE)
        setMarkets((previous) => {
          const merged = initialChunk
            ? nextChunk
            : [...previous, ...nextChunk.filter((entry) => !previous.some((seen) => seen.slug === entry.slug))]
          setSelectedMarket((current) => {
            const requested = requestedSlug ? merged.find((entry) => entry.slug === requestedSlug) : null
            if (requested) return requested
            if (current) {
              const preserved = merged.find((entry) => entry.slug === current.slug)
              if (preserved) return preserved
              if (!initialChunk) return current
            }
            return merged[0] || null
          })
          return merged
        })
      })
      .catch((reason) => {
        if (cancelled) return
        if (initialChunk) setMarkets([])
        setHasMoreMarkets(false)
        setMarketsError(messageOf(reason, "Could not load Polymarket markets."))
      })
      .finally(() => {
        if (cancelled) return
        setLoadingMarkets(false)
        setLoadingMoreMarkets(false)
      })

    return () => {
      cancelled = true
    }
  }, [deferredSearch, marketFeedQueryKey, marketOffset, marketSortMode, requestedSlug, selectedTag])

  useEffect(() => {
    if (!feedLoadMoreRef.current) return
    if (!hasMoreMarkets || loadingMarkets || loadingMoreMarkets) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || marketLoadLockRef.current) return
        marketLoadLockRef.current = true
        setMarketOffset((previous) => previous + MARKET_PAGE_SIZE)
      },
      { root: null, rootMargin: "200px 0px", threshold: 0.01 },
    )
    observer.observe(feedLoadMoreRef.current)
    return () => observer.disconnect()
  }, [hasMoreMarkets, loadingMarkets, loadingMoreMarkets])

  useEffect(() => {
    if (!loadingMoreMarkets) marketLoadLockRef.current = false
  }, [loadingMoreMarkets])

  useEffect(() => {
    if (!connected) {
      setPositions([])
      return
    }
    let cancelled = false
    setLoadingPortfolio(true)
    fetch("/api/polymarket/portfolio", { cache: "no-store" })
      .then(readJson)
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || !Array.isArray(data.positions)) throw new Error("Could not load positions.")
        setPositions(data.positions as PolymarketPosition[])
      })
      .catch(() => {
        if (!cancelled) setPositions([])
      })
      .finally(() => {
        if (!cancelled) setLoadingPortfolio(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected])

  useEffect(() => {
    if (requestedSide === "buy" || requestedSide === "sell") setOrderAction(requestedSide)
  }, [requestedSide])

  useEffect(() => {
    if (!selectedMarket) return
    if (requestedOutcome === "1" || requestedOutcome === "no") setSelectedOutcomeIndex(1)
    else if (requestedOutcome === "0" || requestedOutcome === "yes") setSelectedOutcomeIndex(0)
  }, [requestedOutcome, selectedMarket])

  useEffect(() => {
    if (!selectedMarket || !selectedTokenId) {
      setOrderBook(null)
      setOrderBookError("")
      setLoadingOrderBook(false)
      return
    }
    let cancelled = false
    setLoadingOrderBook(true)
    setOrderBookError("")
    fetch(`/api/polymarket/book/${encodeURIComponent(selectedTokenId)}`, { cache: "no-store" })
      .then(readJson)
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || !data.book) throw new Error(String(data.error || "Could not load the order book."))
        setOrderBook(normalizePolymarketOrderBook(data.book, selectedTokenId))
      })
      .catch((reason) => {
        if (cancelled) return
        setOrderBook(null)
        setOrderBookError(messageOf(reason, "Could not load the order book."))
      })
      .finally(() => {
        if (!cancelled) setLoadingOrderBook(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedMarket, selectedTokenId])

  useEffect(() => {
    let cancelled = false
    setLoadingLeaderboard(true)
    setLeaderboardError("")
    fetch(`/api/polymarket/leaderboard?window=${leaderboardWindow}&limit=10`, { cache: "no-store" })
      .then(readJson)
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || !Array.isArray(data.leaderboard)) throw new Error(String(data.error || "Could not load the leaderboard."))
        const rows = (data.leaderboard as unknown[])
          .map((entry, index) => normalizePolymarketLeaderboardEntry(entry, index + 1))
          .filter((entry): entry is PolymarketLeaderboardEntry => Boolean(entry))
        setLeaderboardEntries(rows)
      })
      .catch((reason) => {
        if (cancelled) return
        setLeaderboardEntries([])
        setLeaderboardError(messageOf(reason, "Could not load the leaderboard."))
      })
      .finally(() => {
        if (!cancelled) setLoadingLeaderboard(false)
      })
    return () => {
      cancelled = true
    }
  }, [leaderboardWindow])

  useEffect(() => {
    if (!selectedTokenId) {
      setHistoryPoints([])
      setLoadingHistory(false)
      setHistoryError("")
      return
    }
    let cancelled = false
    setLoadingHistory(true)
    setHistoryError("")
    fetch(`/api/polymarket/history/${encodeURIComponent(selectedTokenId)}?range=${historyRange}`, { cache: "no-store" })
      .then(readJson)
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || !Array.isArray(data.points)) throw new Error(String(data.error || "Could not load price history."))
        const points = (data.points as unknown[])
          .map((entry) => {
            const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}
            const t = Number(row.t)
            const p = Number(row.p)
            if (!Number.isFinite(t) || !Number.isFinite(p)) return null
            return { t: Math.trunc(t), p: clamp01(p) }
          })
          .filter((entry): entry is PolymarketPricePoint => Boolean(entry))
          .sort((a, b) => a.t - b.t)
        setHistoryPoints(points)
      })
      .catch((reason) => {
        if (cancelled) return
        setHistoryPoints([])
        setHistoryError(messageOf(reason, "Could not load price history."))
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [historyRange, selectedTokenId])

  useEffect(() => {
    if (!selectedTokenId) return
    const wsManager = getGlobalPolymarketWsManager()
    wsManager.connect()
    wsManager.subscribeMarket(selectedTokenId)
    const unsubscribe = wsManager.onPriceUpdate((update) => {
      if (update.tokenId !== selectedTokenId) return
      setSelectedMarket((previous) => (previous ? applyLivePriceUpdateToMarket(previous, update) : previous))
      setMarkets((previous) => previous.map((market) => applyLivePriceUpdateToMarket(market, update)))
    })
    return () => {
      unsubscribe()
      wsManager.unsubscribeMarket(selectedTokenId)
    }
  }, [selectedTokenId])

  const handleSelectMarket = (market: PolymarketMarket) => {
    startTransition(() => setSelectedMarket(market))
    setSelectedOutcomeIndex(0)
  }

  const handleConnect = async () => {
    setSavePending(true)
    try {
      const binding = await connectPolymarketWallet(window)
      const res = await fetch("/api/polymarket/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: binding.walletAddress, signatureType: 0, liveTradingEnabled }),
      })
      const { ok, data } = await readJson(res)
      if (!ok || !data.config) throw new Error(String(data.error || "Could not connect Polymarket."))
      setSettings((prev) => applyPolymarketConfig(prev, data.config as IntegrationsSettings["polymarket"]))
      toast.success({ title: "Wallet connected", description: `${formatAddress(binding.walletAddress)} on Polygon.` })
    } catch (reason) {
      toast.error({ title: "Wallet not connected", description: messageOf(reason, "Could not connect Polymarket.") })
    } finally {
      setSavePending(false)
    }
  }

  const handleDisconnect = async () => {
    setSavePending(true)
    try {
      const res = await fetch("/api/polymarket/disconnect", { method: "POST" })
      const { ok, data } = await readJson(res)
      if (!ok || !data.config) throw new Error(String(data.error || "Could not disconnect Polymarket."))
      setSettings((prev) => applyPolymarketConfig(prev, data.config as IntegrationsSettings["polymarket"]))
      setOpenOrders([])
      setRecentTrades([])
      setPositions([])
      toast.success({ title: "Wallet disconnected" })
    } catch (reason) {
      toast.error({ title: "Disconnect failed", description: messageOf(reason, "Could not disconnect Polymarket.") })
    } finally {
      setSavePending(false)
    }
  }

  const handleToggleLiveTrading = async (nextValue: boolean) => {
    setSavePending(true)
    try {
      const res = await fetch("/api/polymarket/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveTradingEnabled: nextValue }),
      })
      const { ok, data } = await readJson(res)
      if (!ok || !data.config) throw new Error(String(data.error || "Could not update Polymarket settings."))
      setSettings((prev) => applyPolymarketConfig(prev, data.config as IntegrationsSettings["polymarket"]))
    } catch (reason) {
      toast.error({ title: "Live trading not changed", description: messageOf(reason, "Could not update Polymarket settings.") })
    } finally {
      setSavePending(false)
    }
  }

  const loadAuthenticatedActivity = async () => {
    if (!connected) return
    setLoadingActivity(true)
    setActivityError("")
    try {
      const trader = await createPolymarketBrowserTrader({ walletAddress: settings.polymarket.walletAddress, profileAddress: settings.polymarket.profileAddress })
      const [orders, trades] = await Promise.all([trader.getOpenOrders(), trader.getTrades()])
      setOpenOrders(Array.isArray(orders) ? orders.slice(0, 8) : [])
      setRecentTrades(Array.isArray(trades) ? trades.slice(0, 8) : [])
    } catch (reason) {
      setActivityError(messageOf(reason, "Could not load orders and fills."))
    } finally {
      setLoadingActivity(false)
    }
  }

  const handleSubmitTrade = async () => {
    if (!selectedMarket || !selectedOutcome) return
    if (!selectedOutcome.tokenId) {
      toast.error({ title: "Order not sent", description: "This market has no tradable token." })
      return
    }
    setSubmittingTrade(true)
    try {
      const trader = await createPolymarketBrowserTrader({ walletAddress: settings.polymarket.walletAddress, profileAddress: settings.polymarket.profileAddress })
      const response =
        orderAction === "buy"
          ? await trader.submitBuyOrder({ tokenId: selectedOutcome.tokenId, amountUsd: numericAmount, tickSize: selectedMarket.orderPriceMinTickSize, negRisk: selectedMarket.negRisk })
          : await trader.submitSellOrder({ tokenId: selectedOutcome.tokenId, shares: numericAmount, tickSize: selectedMarket.orderPriceMinTickSize, negRisk: selectedMarket.negRisk })
      const orderId = (response as { orderID?: unknown })?.orderID
      toast.success({
        title: `${orderAction === "buy" ? "Buy" : "Sell"} order sent`,
        description: `${selectedOutcome.label}${typeof orderId === "string" ? `, order ${orderId}` : ""}.`,
      })
      await loadAuthenticatedActivity()
    } catch (reason) {
      toast.error({ title: "Order not sent", description: messageOf(reason, "The live trade failed.") })
    } finally {
      setSubmittingTrade(false)
    }
  }

  const selectedSlug = selectedMarket?.slug ?? ""

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Polymarket"
        description="Browse prediction markets, read the order book and trade from your own wallet."
        meta={
          connected ? (
            <Badge tone="success" dot>
              <span className="font-mono">{formatAddress(settings.polymarket.walletAddress)}</span>
            </Badge>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )
        }
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href={SETUP_HREF}>
                <Settings2 />
                Integration settings
              </Link>
            </Button>
            {connected ? (
              <Button variant="outline" size="sm" onClick={() => void handleDisconnect()} loading={savePending}>
                Disconnect wallet
              </Button>
            ) : (
              <Button size="sm" onClick={() => void handleConnect()} loading={savePending}>
                <Wallet />
                Connect wallet
              </Button>
            )}
          </>
        }
      />

      {!connected ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-sm text-muted">
            Polymarket is not connected. Market data is public; positions and trading need a Phantom wallet bound to Polymarket.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href={SETUP_HREF}>Set up Polymarket</Link>
          </Button>
        </div>
      ) : null}

      <div className="mb-4">
        <MarketTicker markets={markets} selectedSlug={selectedSlug} onSelect={handleSelectMarket} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(24rem,1fr)]">
        <Panel
          title="Markets"
          description={search.trim() ? `Results for "${search.trim()}"` : "Active markets, busiest first by default."}
          flush
          bodyClassName="flex flex-col"
        >
          <div className="border-b border-border-subtle px-4 py-3">
            <MarketSearch
              value={search}
              onChange={setSearch}
              tag={selectedTag}
              onTagChange={setSelectedTag}
              tags={marketTagOptions}
              sort={marketSortMode}
              onSortChange={(next) => setMarketSortMode(next as MarketSortMode)}
              sortOptions={MARKET_SORT_OPTIONS}
            />
          </div>
          <div className="max-h-[44rem] min-h-0 overflow-y-auto">
            {loadingMarkets ? (
              <div className="p-4">
                <SkeletonRows rows={10} />
              </div>
            ) : marketsError && markets.length === 0 ? (
              <EmptyState tone="danger" size="compact" title="Markets did not load" description={marketsError} />
            ) : markets.length === 0 ? (
              <EmptyState size="compact" title="No markets match" description="Try another search or tag." />
            ) : (
              <>
                <MarketTable markets={markets} selectedSlug={selectedSlug} onSelect={handleSelectMarket} />
                {hasMoreMarkets ? <div ref={feedLoadMoreRef} className="h-px w-full" aria-hidden /> : null}
                <div className="flex items-center justify-center px-4 py-3 text-xs text-faint">
                  {loadingMoreMarkets ? (
                    "Loading more markets..."
                  ) : hasMoreMarkets ? (
                    <Button variant="ghost" size="sm" onClick={() => setMarketOffset((previous) => previous + MARKET_PAGE_SIZE)}>
                      Load more
                    </Button>
                  ) : (
                    `All ${markets.length} matching markets loaded`
                  )}
                </div>
              </>
            )}
          </div>
        </Panel>

        <div className="flex min-w-0 flex-col gap-4">
          {selectedMarket ? (
            <>
              <Panel>
                <MarketDetail market={selectedMarket} selectedOutcomeIndex={selectedOutcome?.index ?? 0} onSelectOutcome={setSelectedOutcomeIndex} />
              </Panel>
              <Panel title="Price history">
                <PriceChart
                  points={historyPoints}
                  range={historyRange}
                  onRangeChange={setHistoryRange}
                  outcomeLabel={selectedOutcome?.label ?? ""}
                  loading={loadingHistory}
                  error={historyError}
                />
              </Panel>
              <Panel title="Order book">
                <OrderBookVisual outcomeLabel={selectedOutcome?.label ?? ""} orderBook={orderBook} loading={loadingOrderBook} error={orderBookError} />
              </Panel>
              <Panel title="Trade">
                <TradeTicket
                  market={selectedMarket}
                  outcome={selectedOutcome}
                  price={selectedOutcomePrice}
                  action={orderAction}
                  onActionChange={setOrderAction}
                  amount={amount}
                  onAmountChange={setAmount}
                  connected={connected}
                  liveTradingEnabled={liveTradingEnabled}
                  savePending={savePending}
                  onToggleLiveTrading={(next) => void handleToggleLiveTrading(next)}
                  submitting={submittingTrade}
                  onSubmit={() => void handleSubmitTrade()}
                />
              </Panel>
            </>
          ) : (
            <Panel>
              <EmptyState size="compact" title="No market selected" description="Pick a market from the list to see its prices, order book and trade form." />
            </Panel>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(24rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <PortfolioPanel
            connected={connected}
            positions={positions}
            loadingPositions={loadingPortfolio}
            openOrders={openOrders}
            recentTrades={recentTrades}
            loadingActivity={loadingActivity}
            activityError={activityError}
            onRefreshActivity={() => void loadAuthenticatedActivity()}
          />
          <LeaderboardTable
            window={leaderboardWindow}
            entries={leaderboardEntries}
            loading={loadingLeaderboard}
            error={leaderboardError}
            onWindowChange={setLeaderboardWindow}
          />
        </div>
        <LiveLines selectedSlug={selectedSlug} onSelect={handleSelectMarket} />
      </div>

      <p className="mt-6 max-w-[48rem] text-xs text-faint">
        Phantom must expose a verified EVM address before Polymarket can bind to it. Nova stores the binding and your preferences only; keys and
        order approvals stay in the wallet. Disconnecting clears the stored Polymarket identity.
      </p>
    </PageContainer>
  )
}
