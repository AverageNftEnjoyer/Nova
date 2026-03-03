"use client"

import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import { ACTIVE_USER_CHANGED_EVENT, getActiveUserId } from "@/lib/auth/active-user"

export type HomeCryptoAsset = {
  ticker: string
  symbol: string
  price: number
  changePct: number
  chart: number[]
}

export type HomeCryptoRange = "1h" | "1d" | "7d"

type MarketApiResponse = {
  ok?: boolean
  range?: unknown
  assets?: Array<{
    ticker?: unknown
    symbol?: unknown
    price?: unknown
    changePct?: unknown
    changePct24h?: unknown
    chart?: unknown
  }>
  error?: unknown
}

const DEFAULT_CRYPTO_RANGE: HomeCryptoRange = "1d"
const CRYPTO_RANGE_STORAGE_KEY_PREFIX = "nova_home_crypto_range"
const POLL_INTERVAL_MS = 60_000

function normalizeNumber(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeRange(value: unknown): HomeCryptoRange {
  return value === "1h" || value === "7d" ? value : DEFAULT_CRYPTO_RANGE
}

function cryptoRangeStorageKey(): string {
  const userId = getActiveUserId()
  return userId ? `${CRYPTO_RANGE_STORAGE_KEY_PREFIX}:${userId}` : CRYPTO_RANGE_STORAGE_KEY_PREFIX
}

function readPersistedRange(): HomeCryptoRange {
  if (typeof window === "undefined") return DEFAULT_CRYPTO_RANGE
  try {
    return normalizeRange(localStorage.getItem(cryptoRangeStorageKey()))
  } catch {
    return DEFAULT_CRYPTO_RANGE
  }
}

function writePersistedRange(range: HomeCryptoRange): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(cryptoRangeStorageKey(), range)
  } catch {
    // no-op
  }
}

function normalizeAssets(raw: MarketApiResponse["assets"]): HomeCryptoAsset[] {
  if (!Array.isArray(raw)) return []
  const out: HomeCryptoAsset[] = []
  for (const item of raw) {
    const ticker = String(item?.ticker || "").trim().toUpperCase()
    const symbol = String(item?.symbol || "").trim().toUpperCase() || (ticker.split("-")[0] || "")
    if (!ticker || !symbol) continue
    const price = normalizeNumber(item?.price)
    const changePct = normalizeNumber(item?.changePct ?? item?.changePct24h)
    const chart = Array.isArray(item?.chart)
      ? (item?.chart as unknown[]).map((v) => normalizeNumber(v)).filter((v) => Number.isFinite(v) && v > 0)
      : []
    out.push({
      ticker,
      symbol,
      price,
      changePct,
      chart: chart.length > 0 ? chart : [Math.max(0, price)],
    })
  }
  return out
}

export function useHomeCryptoMarket() {
  const [range, setRangeState] = useState<HomeCryptoRange>(DEFAULT_CRYPTO_RANGE)
  const [assets, setAssets] = useState<HomeCryptoAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const setCryptoRange = useCallback((next: HomeCryptoRange) => {
    const normalized = normalizeRange(next)
    setRangeState(normalized)
    writePersistedRange(normalized)
  }, [])

  useLayoutEffect(() => {
    setRangeState(readPersistedRange())
  }, [])

  useEffect(() => {
    const handleActiveUserChanged = () => {
      setRangeState(readPersistedRange())
    }
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, handleActiveUserChanged as EventListener)
    return () => window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, handleActiveUserChanged as EventListener)
  }, [])

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams({ range })
      const res = await fetch(`/api/coinbase/market?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      })
      const data = (await res.json().catch(() => ({}))) as MarketApiResponse
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || "Failed to fetch Coinbase market data."))
      }
      const normalized = normalizeAssets(data.assets)
      if (normalized.length === 0) {
        throw new Error("No market assets returned.")
      }
      setAssets(normalized)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Coinbase market data.")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void refresh(false)
  }, [refresh])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const schedule = () => {
      timer = setTimeout(async () => {
        if (stopped) return
        if (document.visibilityState === "visible") {
          await refresh(true)
        }
        schedule()
      }, POLL_INTERVAL_MS)
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh(true)
      }
    }

    schedule()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [refresh])

  return {
    cryptoAssets: assets,
    cryptoRange: range,
    setCryptoRange,
    cryptoLoading: loading,
    cryptoError: error,
    refreshCryptoMarket: () => refresh(false),
  }
}
