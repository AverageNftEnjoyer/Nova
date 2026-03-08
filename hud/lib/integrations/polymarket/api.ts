export const POLYMARKET_GAMMA_API_URL = "https://gamma-api.polymarket.com"
export const POLYMARKET_CLOB_API_URL = "https://clob.polymarket.com"
export const POLYMARKET_DATA_API_URL = "https://data-api.polymarket.com"
export const POLYMARKET_CHAIN_ID = 137
export const POLYMARKET_CHAIN_HEX_ID = "0x89"

export interface PolymarketTag {
  id: string
  label: string
  slug: string
}

export interface PolymarketOutcome {
  index: number
  label: string
  tokenId: string
  price: number
  bestBid: number
  bestAsk: number
  lastTradePrice: number
}

export interface PolymarketMarket {
  id: string
  slug: string
  question: string
  description: string
  imageUrl: string
  iconUrl: string
  endDate: string
  active: boolean
  closed: boolean
  acceptingOrders: boolean
  liquidity: number
  volume: number
  volume24hr: number
  spread: number
  negRisk: boolean
  startDate: string
  createdAt: string
  orderMinSize: number
  orderPriceMinTickSize: string
  outcomes: PolymarketOutcome[]
  tags: PolymarketTag[]
  resolutionSource: string
  url: string
}

export interface PolymarketProfile {
  walletAddress: string
  profileAddress: string
  username: string
  pseudonym: string
  bio: string
  profileImageUrl: string
}

export interface PolymarketPosition {
  marketId: string
  slug: string
  title: string
  outcome: string
  tokenId: string
  size: number
  avgPrice: number
  currentValue: number
  cashPnl: number
  percentPnl: number
}

export interface PolymarketOrderBookLevel {
  price: number
  size: number
}

export interface PolymarketOrderBook {
  tokenId: string
  bids: PolymarketOrderBookLevel[]
  asks: PolymarketOrderBookLevel[]
  minOrderSize: number
  tickSize: string
  negRisk: boolean
  lastTradePrice: number
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function toSafeString(value: unknown, maxLength = 2000): string {
  return String(value ?? "").trim().slice(0, maxLength)
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const raw = toSafeString(value, 8_000)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseStringArray(value: unknown): string[] {
  return parseJsonArray(value)
    .map((entry) => toSafeString(entry, 256))
    .filter(Boolean)
}

function parseNumberArray(value: unknown): number[] {
  return parseJsonArray(value).map((entry) => toFiniteNumber(entry))
}

function parseTagArray(value: unknown): PolymarketTag[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const source = entry && typeof entry === "object" ? entry as Record<string, unknown> : {}
      const id = toSafeString(source.id, 64)
      const label = toSafeString(source.label, 128)
      const slug = toSafeString(source.slug, 128)
      if (!label && !slug) return null
      return { id, label: label || slug, slug: slug || label.toLowerCase().replace(/\s+/g, "-") }
    })
    .filter((entry): entry is PolymarketTag => Boolean(entry))
}

function getPrimaryEvent(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length === 0) return {}
  const primary = value[0]
  return primary && typeof primary === "object" ? primary as Record<string, unknown> : {}
}

export function normalizePolymarketEvmAddress(value: unknown): string {
  const normalized = String(value || "").trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) return ""
  return normalized.toLowerCase()
}

export function buildPolymarketMarketUrl(slug: string): string {
  const normalized = toSafeString(slug, 256)
  return normalized ? `https://polymarket.com/event/${encodeURIComponent(normalized)}` : "https://polymarket.com"
}

export function normalizePolymarketMarket(raw: unknown): PolymarketMarket | null {
  if (!raw || typeof raw !== "object") return null
  const source = raw as Record<string, unknown>
  const primaryEvent = getPrimaryEvent(source.events)
  const slug = toSafeString(source.slug, 256)
  const question = toSafeString(source.question || source.title, 280)
  if (!slug || !question) return null

  const parsedOutcomes = parseJsonArray(source.outcomes)
  const normalizedOutcomeObjects = parsedOutcomes
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null
      const row = entry as Record<string, unknown>
      const label = toSafeString(row.label ?? row.name ?? row.title ?? row.outcome, 256)
      const tokenId = toSafeString(row.tokenId ?? row.token_id ?? row.asset_id, 128)
      if (!label && !tokenId) return null
      return {
        index: Number.isInteger(row.index) ? Number(row.index) : index,
        label,
        tokenId,
        price: toFiniteNumber(row.price),
        bestBid: toFiniteNumber(row.bestBid ?? row.best_bid),
        bestAsk: toFiniteNumber(row.bestAsk ?? row.best_ask),
        lastTradePrice: toFiniteNumber(row.lastTradePrice ?? row.last_trade_price),
      }
    })
    .filter((entry): entry is PolymarketOutcome => Boolean(entry))
  const outcomeLabels = normalizedOutcomeObjects.length > 0 ? [] : parseStringArray(source.outcomes)
  const outcomePrices = normalizedOutcomeObjects.length > 0 ? [] : parseNumberArray(source.outcomePrices)
  const tokenIds = normalizedOutcomeObjects.length > 0 ? [] : parseStringArray(source.clobTokenIds)
  const bestBid = toFiniteNumber(source.bestBid)
  const bestAsk = toFiniteNumber(source.bestAsk)
  const lastTradePrice = toFiniteNumber(source.lastTradePrice)
  const outcomes =
    normalizedOutcomeObjects.length > 0
      ? normalizedOutcomeObjects
      : outcomeLabels.map((label, index) => ({
          index,
          label,
          tokenId: toSafeString(tokenIds[index], 128),
          price: outcomePrices[index] ?? 0,
          bestBid: index === 0 && bestBid > 0 ? bestBid : index === 1 && bestAsk > 0 ? Math.max(0, 1 - bestAsk) : 0,
          bestAsk: index === 0 && bestAsk > 0 ? bestAsk : index === 1 && bestBid > 0 ? Math.max(0, 1 - bestBid) : 0,
          lastTradePrice: index === 0 ? lastTradePrice : lastTradePrice > 0 ? Math.max(0, 1 - lastTradePrice) : 0,
        }))

  return {
    id: toSafeString(source.id, 64),
    slug,
    question,
    description: toSafeString(source.description || primaryEvent.description, 8_000),
    imageUrl: toSafeString(source.image, 512),
    iconUrl: toSafeString(source.icon, 512),
    endDate: toSafeString(source.endDate, 64),
    active: source.active === true,
    closed: source.closed === true,
    acceptingOrders: source.acceptingOrders === true,
    liquidity: toFiniteNumber(source.liquidityNum ?? source.liquidityClob ?? source.liquidity),
    volume: toFiniteNumber(source.volumeNum ?? source.volumeClob ?? source.volume),
    volume24hr: toFiniteNumber(source.volume24hrClob ?? source.volume24hr),
    spread: toFiniteNumber(source.spread),
    negRisk: source.negRisk === true,
    startDate: toSafeString(source.startDate || primaryEvent.startDate, 64),
    createdAt: toSafeString(source.createdAt || primaryEvent.creationDate, 64),
    orderMinSize: toFiniteNumber(source.orderMinSize),
    orderPriceMinTickSize: toSafeString(source.orderPriceMinTickSize || "0.01", 16) || "0.01",
    outcomes: outcomes.filter((entry) => entry.label || entry.tokenId),
    tags: parseTagArray(source.tags),
    resolutionSource: toSafeString(source.resolutionSource || primaryEvent.resolutionSource, 512),
    url: buildPolymarketMarketUrl(slug),
  }
}

export function normalizePolymarketProfile(raw: unknown, walletAddress = ""): PolymarketProfile {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const normalizedWalletAddress = normalizePolymarketEvmAddress(walletAddress || source.wallet_address || source.address)
  const profileAddress =
    normalizePolymarketEvmAddress(source.proxyWallet) ||
    normalizePolymarketEvmAddress(source.profileAddress) ||
    normalizedWalletAddress
  return {
    walletAddress: normalizedWalletAddress,
    profileAddress,
    username: toSafeString(source.username, 128),
    pseudonym: toSafeString(source.pseudonym || source.displayName || source.name, 128),
    bio: toSafeString(source.bio, 512),
    profileImageUrl: toSafeString(source.profileImage || source.profileImageUrl, 512),
  }
}

export function normalizePolymarketPosition(raw: unknown): PolymarketPosition | null {
  if (!raw || typeof raw !== "object") return null
  const source = raw as Record<string, unknown>
  const tokenId = toSafeString(source.asset ?? source.asset_id ?? source.token_id, 128)
  const slug = toSafeString(source.slug ?? source.market_slug, 256)
  const title = toSafeString(source.title ?? source.question, 280)
  const outcome = toSafeString(source.outcome, 128)
  if (!tokenId && !slug && !title) return null
  return {
    marketId: toSafeString(source.conditionId ?? source.condition_id ?? source.market, 128),
    slug,
    title,
    outcome,
    tokenId,
    size: toFiniteNumber(source.size ?? source.amount ?? source.balance),
    avgPrice: toFiniteNumber(source.avgPrice ?? source.avg_price),
    currentValue: toFiniteNumber(source.currentValue ?? source.curValue ?? source.current_value ?? source.value),
    cashPnl: toFiniteNumber(source.cashPnl ?? source.cash_pnl ?? source.realized_pnl),
    percentPnl: toFiniteNumber(source.percentPnl ?? source.percent_pnl ?? source.percent_change),
  }
}

export function normalizePolymarketOrderBook(raw: unknown, tokenId = ""): PolymarketOrderBook {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const normalizeLevels = (input: unknown): PolymarketOrderBookLevel[] => {
    if (!Array.isArray(input)) return []
    return input
      .map((entry) => {
        const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {}
        return {
          price: toFiniteNumber(row.price),
          size: toFiniteNumber(row.size),
        }
      })
      .filter((entry) => entry.price > 0 && entry.size > 0)
  }
  return {
    tokenId: toSafeString(source.asset_id || tokenId, 128) || tokenId,
    bids: normalizeLevels(source.bids),
    asks: normalizeLevels(source.asks),
    minOrderSize: toFiniteNumber(source.min_order_size),
    tickSize: toSafeString(source.tick_size || "0.01", 16) || "0.01",
    negRisk: source.neg_risk === true,
    lastTradePrice: toFiniteNumber(source.last_trade_price),
  }
}
