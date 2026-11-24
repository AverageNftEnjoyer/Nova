export const POLYMARKET_CLOB_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/"

export type PolymarketWsChannel = "market" | "user"

export interface PolymarketWsSubscription {
  channel: PolymarketWsChannel
  tokenId: string
  market?: string
  user?: string
}

export interface PolymarketWsPriceUpdate {
  tokenId: string
  bid?: number
  ask?: number
  midpoint?: number
  spread?: number
  lastTradePrice?: number
  ts: number
  raw: unknown
}

export interface PolymarketWsOptions {
  url?: string
  heartbeatMs?: number
  reconnectMinMs?: number
  reconnectMaxMs?: number
  maxSubscriptions?: number
}

const DEFAULT_HEARTBEAT_MS = 30_000
const DEFAULT_RECONNECT_MIN_MS = 1_000
const DEFAULT_RECONNECT_MAX_MS = 30_000
const DEFAULT_MAX_SUBSCRIPTIONS = 50

type Listener<T> = (value: T) => void
type ErrorListener = (error: Error) => void

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeTokenId(raw: unknown): string {
  return String(raw ?? "").trim()
}

function buildSubscriptionKey(sub: PolymarketWsSubscription): string {
  return `${sub.channel}:${sub.tokenId}`
}

function parsePriceUpdate(payload: unknown): PolymarketWsPriceUpdate | null {
  if (!payload || typeof payload !== "object") return null
  const row = payload as Record<string, unknown>
  const tokenId = normalizeTokenId(
    row.asset_id
    ?? row.assetId
    ?? row.token_id
    ?? row.tokenId
    ?? row.market
    ?? row.marketId,
  )
  if (!tokenId) return null
  const bid = toFiniteNumber(row.bid ?? row.best_bid ?? row.bestBid)
  const ask = toFiniteNumber(row.ask ?? row.best_ask ?? row.bestAsk)
  const midpoint = toFiniteNumber(row.mid ?? row.midpoint)
  const spread = toFiniteNumber(row.spread)
  const lastTradePrice = toFiniteNumber(row.last_trade_price ?? row.lastTradePrice ?? row.price)
  if (
    bid === null
    && ask === null
    && midpoint === null
    && spread === null
    && lastTradePrice === null
  ) {
    return null
  }
  return {
    tokenId,
    bid: bid ?? undefined,
    ask: ask ?? undefined,
    midpoint: midpoint ?? undefined,
    spread: spread ?? undefined,
    lastTradePrice: lastTradePrice ?? undefined,
    ts: Date.now(),
    raw: payload,
  }
}

export class PolymarketWebSocketManager {
  private readonly url: string
  private readonly heartbeatMs: number
  private readonly reconnectMinMs: number
  private readonly reconnectMaxMs: number
  private readonly maxSubscriptions: number

  private ws: WebSocket | null = null
  private manualClose = false
  private reconnectDelayMs: number
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  private readonly subscriptions = new Map<string, PolymarketWsSubscription>()
  private readonly priceListeners = new Set<Listener<PolymarketWsPriceUpdate>>()
  private readonly openListeners = new Set<Listener<void>>()
  private readonly closeListeners = new Set<Listener<CloseEvent | undefined>>()
  private readonly errorListeners = new Set<ErrorListener>()

  constructor(options: PolymarketWsOptions = {}) {
    this.url = String(options.url || POLYMARKET_CLOB_WS_URL).trim() || POLYMARKET_CLOB_WS_URL
    this.heartbeatMs = Math.max(5_000, Math.floor(Number(options.heartbeatMs || DEFAULT_HEARTBEAT_MS)))
    this.reconnectMinMs = Math.max(250, Math.floor(Number(options.reconnectMinMs || DEFAULT_RECONNECT_MIN_MS)))
    this.reconnectMaxMs = Math.max(this.reconnectMinMs, Math.floor(Number(options.reconnectMaxMs || DEFAULT_RECONNECT_MAX_MS)))
    this.maxSubscriptions = Math.max(1, Math.floor(Number(options.maxSubscriptions || DEFAULT_MAX_SUBSCRIPTIONS)))
    this.reconnectDelayMs = this.reconnectMinMs
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  get subscriptionCount(): number {
    return this.subscriptions.size
  }

  onPriceUpdate(listener: Listener<PolymarketWsPriceUpdate>): () => void {
    this.priceListeners.add(listener)
    return () => this.priceListeners.delete(listener)
  }

  onOpen(listener: Listener<void>): () => void {
    this.openListeners.add(listener)
    return () => this.openListeners.delete(listener)
  }

  onClose(listener: Listener<CloseEvent | undefined>): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  connect(): void {
    if (typeof WebSocket === "undefined") {
      this.emitError(new Error("WebSocket is unavailable in this runtime."))
      return
    }
    this.manualClose = false
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.clearReconnectTimer()
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.reconnectDelayMs = this.reconnectMinMs
      this.startHeartbeat()
      this.flushSubscriptions()
      for (const listener of this.openListeners) listener()
    }
    ws.onmessage = (event) => {
      this.handleMessage(event.data)
    }
    ws.onerror = () => {
      this.emitError(new Error("Polymarket websocket error."))
    }
    ws.onclose = (event) => {
      this.stopHeartbeat()
      for (const listener of this.closeListeners) listener(event)
      if (!this.manualClose) {
        this.scheduleReconnect()
      }
    }
  }

  close(): void {
    this.manualClose = true
    this.clearReconnectTimer()
    this.stopHeartbeat()
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // Ignore close errors from stale sockets.
      }
    }
    this.ws = null
  }

  subscribeMarket(tokenId: string): boolean {
    const normalized = normalizeTokenId(tokenId)
    if (!normalized) return false
    const sub: PolymarketWsSubscription = { channel: "market", tokenId: normalized }
    const key = buildSubscriptionKey(sub)
    if (!this.subscriptions.has(key) && this.subscriptions.size >= this.maxSubscriptions) {
      return false
    }
    this.subscriptions.set(key, sub)
    this.sendSubscribe(sub)
    return true
  }

  unsubscribeMarket(tokenId: string): boolean {
    const normalized = normalizeTokenId(tokenId)
    if (!normalized) return false
    const sub: PolymarketWsSubscription = { channel: "market", tokenId: normalized }
    const key = buildSubscriptionKey(sub)
    const removed = this.subscriptions.delete(key)
    if (removed) this.sendUnsubscribe(sub)
    return removed
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }

  private flushSubscriptions(): void {
    for (const sub of this.subscriptions.values()) {
      this.sendSubscribe(sub)
    }
  }

  private buildWirePayload(type: "subscribe" | "unsubscribe", sub: PolymarketWsSubscription): Record<string, unknown> {
    return {
      type,
      channel: sub.channel,
      asset_id: sub.tokenId,
      asset_ids: [sub.tokenId],
      market: sub.market || undefined,
      user: sub.user || undefined,
    }
  }

  private sendSubscribe(sub: PolymarketWsSubscription): void {
    this.sendJson(this.buildWirePayload("subscribe", sub))
  }

  private sendUnsubscribe(sub: PolymarketWsSubscription): void {
    this.sendJson(this.buildWirePayload("unsubscribe", sub))
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify(payload))
    } catch {
      // Ignore transient send failures and rely on reconnect flow.
    }
  }

  private handleMessage(raw: unknown): void {
    let payload: unknown = raw
    if (typeof raw === "string") {
      try {
        payload = JSON.parse(raw)
      } catch {
        return
      }
    }
    if (Array.isArray(payload)) {
      for (const item of payload) this.handleParsedPayload(item)
      return
    }
    this.handleParsedPayload(payload)
  }

  private handleParsedPayload(payload: unknown): void {
    const parsed = parsePriceUpdate(payload)
    if (parsed) {
      for (const listener of this.priceListeners) listener(parsed)
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer()
    const delayMs = Math.max(this.reconnectMinMs, Math.min(this.reconnectDelayMs, this.reconnectMaxMs))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delayMs)
    this.reconnectDelayMs = Math.min(Math.round(this.reconnectDelayMs * 2), this.reconnectMaxMs)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.sendJson({ type: "ping", ts: Date.now() })
    }, this.heartbeatMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}

type GlobalPolymarketWsState = typeof globalThis & {
  __novaPolymarketWsManager?: PolymarketWebSocketManager
}

export function getGlobalPolymarketWsManager(options: PolymarketWsOptions = {}): PolymarketWebSocketManager {
  const state = globalThis as GlobalPolymarketWsState
  if (state.__novaPolymarketWsManager) return state.__novaPolymarketWsManager
  state.__novaPolymarketWsManager = new PolymarketWebSocketManager(options)
  return state.__novaPolymarketWsManager
}
