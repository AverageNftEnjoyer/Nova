import assert from "node:assert/strict"
import test from "node:test"

import { normalizePolymarketMarket } from "../api.ts"

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
