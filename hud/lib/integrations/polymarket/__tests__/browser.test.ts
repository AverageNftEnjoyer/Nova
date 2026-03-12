import assert from "node:assert/strict"
import test from "node:test"

import { POLYMARKET_CHAIN_HEX_ID } from "../api.ts"
import { connectPolymarketWallet } from "../browser.ts"

type RpcPayload = { method: string; params?: unknown }

type MockProvider = {
  isPhantom: true
  request: (payload: RpcPayload) => Promise<unknown>
}

function buildWindow(provider: MockProvider): Window & typeof globalThis {
  return {
    phantom: {
      ethereum: provider,
    },
  } as unknown as Window & typeof globalThis
}

test("polymarket browser connect returns normalized wallet and chain when already on polygon", async () => {
  const calls: string[] = []
  const provider: MockProvider = {
    isPhantom: true,
    request: async ({ method }) => {
      calls.push(method)
      if (method === "eth_requestAccounts") return ["0xAbCdEfabcdefABCDEFabcdefabcdefabcdefABCD"]
      if (method === "eth_chainId") return POLYMARKET_CHAIN_HEX_ID
      throw new Error(`Unexpected method: ${method}`)
    },
  }

  const binding = await connectPolymarketWallet(buildWindow(provider))
  assert.equal(binding.walletAddress, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
  assert.equal(binding.chainId, POLYMARKET_CHAIN_HEX_ID)
  assert.equal(calls.includes("wallet_switchEthereumChain"), false)
})

test("polymarket browser connect switches to polygon when starting on another chain", async () => {
  const calls: string[] = []
  let chainReadCount = 0
  const provider: MockProvider = {
    isPhantom: true,
    request: async ({ method }) => {
      calls.push(method)
      if (method === "eth_requestAccounts") return ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
      if (method === "eth_chainId") {
        chainReadCount += 1
        return chainReadCount === 1 ? "0x1" : POLYMARKET_CHAIN_HEX_ID
      }
      if (method === "wallet_switchEthereumChain") return null
      throw new Error(`Unexpected method: ${method}`)
    },
  }

  const binding = await connectPolymarketWallet(buildWindow(provider))
  assert.equal(binding.chainId, POLYMARKET_CHAIN_HEX_ID)
  assert.equal(calls.filter((method) => method === "wallet_switchEthereumChain").length, 1)
})

test("polymarket browser connect adds polygon chain when wallet reports unknown chain", async () => {
  const calls: string[] = []
  let chainReadCount = 0
  let switchAttemptCount = 0
  const provider: MockProvider = {
    isPhantom: true,
    request: async ({ method }) => {
      calls.push(method)
      if (method === "eth_requestAccounts") return ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]
      if (method === "eth_chainId") {
        chainReadCount += 1
        return chainReadCount === 1 ? "0x1" : POLYMARKET_CHAIN_HEX_ID
      }
      if (method === "wallet_switchEthereumChain") {
        switchAttemptCount += 1
        if (switchAttemptCount === 1) {
          const error = new Error("Unknown chain") as Error & { code: number }
          error.code = 4902
          throw error
        }
        return null
      }
      if (method === "wallet_addEthereumChain") return null
      throw new Error(`Unexpected method: ${method}`)
    },
  }

  const binding = await connectPolymarketWallet(buildWindow(provider))
  assert.equal(binding.chainId, POLYMARKET_CHAIN_HEX_ID)
  assert.equal(calls.filter((method) => method === "wallet_addEthereumChain").length, 1)
  assert.equal(calls.filter((method) => method === "wallet_switchEthereumChain").length, 2)
})

test("polymarket browser connect fails when chain remains non-polygon after switch", async () => {
  const provider: MockProvider = {
    isPhantom: true,
    request: async ({ method }) => {
      if (method === "eth_requestAccounts") return ["0xcccccccccccccccccccccccccccccccccccccccc"]
      if (method === "eth_chainId") return "0x1"
      if (method === "wallet_switchEthereumChain") return null
      throw new Error(`Unexpected method: ${method}`)
    },
  }

  await assert.rejects(
    () => connectPolymarketWallet(buildWindow(provider)),
    /Phantom must be connected to Polygon Mainnet before trading on Polymarket\./,
  )
})
