import assert from "node:assert/strict"
import test from "node:test"

import {
  getPhantomEthereumProvider,
  getPhantomSolanaProvider,
  normalizeEvmAddress,
  readObservedPhantomEvmState,
  resolvePhantomContextSupport,
} from "../browser.ts"

test("phantom browser support rejects embedded and insecure contexts", () => {
  const embedded = resolvePhantomContextSupport({
    location: { protocol: "https:", hostname: "app.nova.local" },
    self: {},
    top: {},
  })
  assert.equal(embedded.supported, false)
  assert.equal(embedded.code, "embedded_frame")

  const insecure = resolvePhantomContextSupport({
    location: { protocol: "http:", hostname: "nova.example.com" },
    self: undefined,
    top: undefined,
  })
  assert.equal(insecure.supported, false)
  assert.equal(insecure.code, "insecure_origin")

  const localhost = resolvePhantomContextSupport({
    location: { protocol: "http:", hostname: "localhost" },
    self: {},
    top: undefined,
  })
  assert.equal(localhost.supported, true)
})

test("phantom browser helpers resolve only Phantom providers and normalize evm state", async () => {
  const solanaProvider = {
    isPhantom: true,
    connect: async () => ({ publicKey: null }),
    disconnect: async () => undefined,
    signMessage: async () => ({ signature: new Uint8Array() }),
  }
  const ethereumProvider = {
    isPhantom: true,
    request: async ({ method }: { method: string }) => {
      if (method === "eth_accounts") return ["0xAbCdEfabcdefABCDEFabcdefabcdefabcdefABCD"]
      if (method === "eth_chainId") return "0x89"
      return null
    },
  }

  const resolvedSolana = getPhantomSolanaProvider({
    phantom: { solana: solanaProvider, ethereum: ethereumProvider },
  })
  const resolvedEthereum = getPhantomEthereumProvider({
    phantom: { solana: solanaProvider, ethereum: ethereumProvider },
  })
  assert.equal(resolvedSolana, solanaProvider)
  assert.equal(resolvedEthereum, ethereumProvider)

  const observed = await readObservedPhantomEvmState(ethereumProvider)
  assert.equal(observed.evmAvailable, true)
  assert.equal(observed.evmAddress, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
  assert.equal(observed.evmChainId, "0x89")
  assert.equal(normalizeEvmAddress("0xABCDEFabcdefABCDEFabcdefabcdefabcdefABCD"), "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
})
