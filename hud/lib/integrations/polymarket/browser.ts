import {
  AssetType,
  Chain,
  ClobClient,
  OrderType,
  Side,
  type ApiKeyCreds,
} from "@polymarket/clob-client"
import { createWalletClient, custom, type Address } from "viem"
import { polygon } from "viem/chains"

import {
  POLYMARKET_CHAIN_HEX_ID,
  POLYMARKET_CLOB_API_URL,
  normalizePolymarketEvmAddress,
} from "./api"
import { getPhantomEthereumProvider, type PhantomEthereumProvider } from "../phantom/browser"

export interface PolymarketWalletBinding {
  provider: PhantomEthereumProvider
  walletAddress: string
  chainId: string
}

export interface PolymarketBrowserTrader {
  walletAddress: string
  profileAddress: string
  getOpenOrders: () => Promise<unknown[]>
  getTrades: () => Promise<unknown[]>
  cancelAll: () => Promise<unknown>
  submitBuyOrder: (input: {
    tokenId: string
    amountUsd: number
    tickSize: string
    negRisk: boolean
  }) => Promise<unknown>
  submitSellOrder: (input: {
    tokenId: string
    shares: number
    tickSize: string
    negRisk: boolean
  }) => Promise<unknown>
}

function normalizeAccounts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => normalizePolymarketEvmAddress(entry)).filter(Boolean)
    : []
}

async function switchToPolygon(provider: PhantomEthereumProvider): Promise<string> {
  try {
    const chainId = String(await provider.request({ method: "eth_chainId" }) || "").trim().toLowerCase()
    if (chainId === POLYMARKET_CHAIN_HEX_ID) return chainId
  } catch {
    // Continue to explicit switch.
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: POLYMARKET_CHAIN_HEX_ID }],
    })
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "number" ? Number((error as { code: number }).code) : null
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: POLYMARKET_CHAIN_HEX_ID,
          chainName: "Polygon Mainnet",
          nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
          rpcUrls: ["https://polygon-rpc.com"],
          blockExplorerUrls: ["https://polygonscan.com"],
        }],
      })
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: POLYMARKET_CHAIN_HEX_ID }],
      })
    } else {
      throw error
    }
  }

  return String(await provider.request({ method: "eth_chainId" }) || "").trim().toLowerCase()
}

function buildWalletClient(provider: PhantomEthereumProvider, walletAddress: string) {
  return createWalletClient({
    account: walletAddress as Address,
    chain: polygon,
    transport: custom(provider as never),
  })
}

async function createClientWithCreds(input: {
  provider: PhantomEthereumProvider
  walletAddress: string
  profileAddress: string
}): Promise<{ client: ClobClient; creds: ApiKeyCreds }> {
  const walletClient = buildWalletClient(input.provider, input.walletAddress)
  const bootstrapClient = new ClobClient(
    POLYMARKET_CLOB_API_URL,
    Chain.POLYGON,
    walletClient,
    undefined,
    0,
    input.profileAddress || input.walletAddress,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
    undefined,
    true,
  )
  const creds = await bootstrapClient.createOrDeriveApiKey()
  const client = new ClobClient(
    POLYMARKET_CLOB_API_URL,
    Chain.POLYGON,
    walletClient,
    creds,
    0,
    input.profileAddress || input.walletAddress,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
    undefined,
    true,
  )
  return { client, creds }
}

function assertPositiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`)
  }
  return value
}

export async function connectPolymarketWallet(win: Window & typeof globalThis): Promise<PolymarketWalletBinding> {
  const provider = getPhantomEthereumProvider(win)
  if (!provider) {
    throw new Error("Phantom EVM wallet is not available in this browser.")
  }

  const accounts = normalizeAccounts(await provider.request({ method: "eth_requestAccounts" }))
  const walletAddress = accounts[0] || ""
  if (!walletAddress) {
    throw new Error("Phantom did not return an EVM wallet address.")
  }
  const chainId = await switchToPolygon(provider)
  return {
    provider,
    walletAddress,
    chainId,
  }
}

export async function createPolymarketBrowserTrader(input: {
  provider?: PhantomEthereumProvider | null
  walletAddress: string
  profileAddress?: string
}): Promise<PolymarketBrowserTrader> {
  const provider = input.provider || (typeof window !== "undefined" ? getPhantomEthereumProvider(window) : null)
  if (!provider) {
    throw new Error("Phantom EVM wallet is not available.")
  }
  const walletAddress = normalizePolymarketEvmAddress(input.walletAddress)
  if (!walletAddress) {
    throw new Error("A valid EVM wallet address is required.")
  }
  const profileAddress = normalizePolymarketEvmAddress(input.profileAddress) || walletAddress
  await switchToPolygon(provider)
  const { client } = await createClientWithCreds({
    provider,
    walletAddress,
    profileAddress,
  })

  return {
    walletAddress,
    profileAddress,
    getOpenOrders: async () => client.getOpenOrders({}),
    getTrades: async () => client.getTrades({ maker_address: profileAddress }, true),
    cancelAll: async () => client.cancelAll(),
    submitBuyOrder: async ({ tokenId, amountUsd, tickSize, negRisk }) => {
      const normalizedTokenId = String(tokenId || "").trim()
      if (!normalizedTokenId) throw new Error("A market token is required.")
      await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL })
      return client.createAndPostMarketOrder(
        {
          tokenID: normalizedTokenId,
          amount: assertPositiveNumber(amountUsd, "Buy amount"),
          side: Side.BUY,
          orderType: OrderType.FOK,
        },
        {
          tickSize: (String(tickSize || "0.01").trim() || "0.01") as "0.1" | "0.01" | "0.001" | "0.0001",
          negRisk,
        },
        OrderType.FOK,
      )
    },
    submitSellOrder: async ({ tokenId, shares, tickSize, negRisk }) => {
      const normalizedTokenId = String(tokenId || "").trim()
      if (!normalizedTokenId) throw new Error("A market token is required.")
      await client.updateBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: normalizedTokenId })
      return client.createAndPostMarketOrder(
        {
          tokenID: normalizedTokenId,
          amount: assertPositiveNumber(shares, "Sell size"),
          side: Side.SELL,
          orderType: OrderType.FOK,
        },
        {
          tickSize: (String(tickSize || "0.01").trim() || "0.01") as "0.1" | "0.01" | "0.001" | "0.0001",
          negRisk,
        },
        OrderType.FOK,
      )
    },
  }
}
