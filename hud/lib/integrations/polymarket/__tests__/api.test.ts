import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizePolymarketEvent,
  normalizePolymarketLeaderboardEntry,
  normalizePolymarketMarket,
  normalizePolymarketTokenPrice,
} from "../api.ts"

test("normalizePolymarketMarket handles raw Gamma payloads", () => {
  const market = normalizePolymarketMarket({
    id: "mkt-1",
    slug: "btc-over-200k",
    question: "BTC over 200k in 2026?",
    outcomes: "[\"Yes\", \"No\"]",
    outcomePrices: "[\"0.42\", \"0.58\"]",
    clobTokenIds: "[\"yes-token\", \"no-token\"]",
    lastTradePrice: 0.42,
    bestBid: 0.41,
    bestAsk: 0.43,
    acceptingOrders: true,
  })

  assert.ok(market)
  assert.equal(market.outcomes[0]?.label, "Yes")
  assert.equal(market.outcomes[0]?.price, 0.42)
  assert.equal(market.outcomes[1]?.label, "No")
  assert.equal(market.outcomes[1]?.price, 0.58)
})

test("normalizePolymarketMarket preserves already-normalized outcome objects", () => {
  const market = normalizePolymarketMarket({
    id: "mkt-2",
    slug: "bitboy-convicted",
    question: "BitBoy convicted?",
    outcomes: [
      {
        index: 0,
        label: "Yes",
        tokenId: "yes-token",
        price: 0.1225,
        bestBid: 0.119,
        bestAsk: 0.126,
        lastTradePrice: 0.12,
      },
      {
        index: 1,
        label: "No",
        tokenId: "no-token",
        price: 0.8775,
        bestBid: 0.874,
        bestAsk: 0.881,
        lastTradePrice: 0.88,
      },
    ],
    acceptingOrders: true,
  })

  assert.ok(market)
  assert.equal(market.outcomes[0]?.label, "Yes")
  assert.equal(market.outcomes[0]?.price, 0.1225)
  assert.equal(market.outcomes[1]?.label, "No")
  assert.equal(market.outcomes[1]?.price, 0.8775)
})

test("normalizePolymarketEvent parses event payloads with embedded market summaries", () => {
  const event = normalizePolymarketEvent({
    id: "evt-1",
    slug: "us-election-2028",
    title: "US Election 2028",
    active: true,
    volume24hr: 123456.78,
    markets: [
      {
        id: "mkt-10",
        slug: "candidate-a-wins",
        question: "Candidate A wins?",
        acceptingOrders: true,
      },
    ],
  })

  assert.ok(event)
  assert.equal(event.title, "US Election 2028")
  assert.equal(event.markets[0]?.slug, "candidate-a-wins")
  assert.equal(event.markets[0]?.acceptingOrders, true)
  assert.equal(event.volume24hr, 123456.78)
})

test("normalizePolymarketTokenPrice normalizes token identifiers and side hints", () => {
  const price = normalizePolymarketTokenPrice({
    token_id: "123456789",
    price: "0.643",
    side: "buy",
  })

  assert.ok(price)
  assert.equal(price.tokenId, "123456789")
  assert.equal(price.price, 0.643)
  assert.equal(price.side, "BUY")
})

test("normalizePolymarketLeaderboardEntry preserves rank fallback and address normalization", () => {
  const entry = normalizePolymarketLeaderboardEntry(
    {
      address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      username: "trader-a",
      pnl: "420.5",
      volume: "12345",
    },
    3,
  )

  assert.ok(entry)
  assert.equal(entry.rank, 3)
  assert.equal(entry.walletAddress, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  assert.equal(entry.username, "trader-a")
  assert.equal(entry.pnl, 420.5)
  assert.equal(entry.volume, 12345)
})
