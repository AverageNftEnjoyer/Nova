export const PHANTOM_APP_URL = "https://phantom.app/"

export interface PhantomPublicKeyLike {
  toString(): string
  toBytes?(): Uint8Array
}

export interface PhantomConnectResponse {
  publicKey?: PhantomPublicKeyLike | null
}

export interface PhantomSignatureResponse {
  signature?: Uint8Array | ArrayBuffer | number[] | null
}

export interface PhantomSolanaProvider {
  isPhantom?: boolean
  isConnected?: boolean
  publicKey?: PhantomPublicKeyLike | null
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<PhantomConnectResponse>
  disconnect: () => Promise<void>
  signMessage: (message: Uint8Array, display?: "utf8" | "hex") => Promise<PhantomSignatureResponse>
  on?: (event: "connect" | "disconnect" | "accountChanged", listener: (...args: unknown[]) => void) => void
  off?: (event: "connect" | "disconnect" | "accountChanged", listener: (...args: unknown[]) => void) => void
  removeListener?: (event: "connect" | "disconnect" | "accountChanged", listener: (...args: unknown[]) => void) => void
}

export interface PhantomEthereumProvider {
  isPhantom?: boolean
  request: (payload: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>
  on?: (event: "accountsChanged" | "chainChanged" | "disconnect", listener: (...args: unknown[]) => void) => void
  off?: (event: "accountsChanged" | "chainChanged" | "disconnect", listener: (...args: unknown[]) => void) => void
  removeListener?: (event: "accountsChanged" | "chainChanged" | "disconnect", listener: (...args: unknown[]) => void) => void
}

export interface PhantomBrowserWindowLike {
  location?: {
    href?: string
    origin?: string
    protocol?: string
    hostname?: string
  }
  self?: unknown
  top?: unknown
  phantom?: {
    solana?: PhantomSolanaProvider
    ethereum?: PhantomEthereumProvider
  }
  solana?: PhantomSolanaProvider
}

export interface PhantomContextSupport {
  supported: boolean
  code: "ok" | "embedded_frame" | "insecure_origin"
  reason: string
}

export interface PhantomObservedEvmState {
  evmAvailable: boolean
  evmAddress: string
  evmChainId: string
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost")
  )
}

export function normalizeEvmAddress(value: unknown): string {
  const normalized = String(value || "").trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) return ""
  return normalized.toLowerCase()
}

export function resolvePhantomContextSupport(win: PhantomBrowserWindowLike | null | undefined): PhantomContextSupport {
  if (!win) {
    return { supported: false, code: "insecure_origin", reason: "Phantom wallet connect requires a browser window." }
  }
  if (typeof win.top !== "undefined" && typeof win.self !== "undefined" && win.top !== win.self) {
    return {
      supported: false,
      code: "embedded_frame",
      reason: "Phantom wallet connect must run in a top-level window, not an embedded frame.",
    }
  }
  const protocol = String(win.location?.protocol || "").trim().toLowerCase()
  const hostname = String(win.location?.hostname || "").trim().toLowerCase()
  const secureOrigin = protocol === "https:" || isLoopbackHost(hostname)
  if (!secureOrigin) {
    return {
      supported: false,
      code: "insecure_origin",
      reason: "Phantom wallet connect requires https or localhost.",
    }
  }
  return { supported: true, code: "ok", reason: "" }
}

export function getPhantomSolanaProvider(win: PhantomBrowserWindowLike | null | undefined): PhantomSolanaProvider | null {
  if (!win) return null
  const provider = win.phantom?.solana || win.solana || null
  if (!provider || provider.isPhantom !== true) return null
  return provider
}

export function getPhantomEthereumProvider(win: PhantomBrowserWindowLike | null | undefined): PhantomEthereumProvider | null {
  if (!win) return null
  const provider = win.phantom?.ethereum || null
  if (!provider || provider.isPhantom !== true || typeof provider.request !== "function") return null
  return provider
}

function normalizeAccountsResponse(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => normalizeEvmAddress(entry)).filter(Boolean)
    : []
}

export async function readObservedPhantomEvmState(
  provider: PhantomEthereumProvider | null | undefined,
): Promise<PhantomObservedEvmState> {
  if (!provider) {
    return { evmAvailable: false, evmAddress: "", evmChainId: "" }
  }
  try {
    const [accountsResult, chainIdResult] = await Promise.all([
      provider.request({ method: "eth_accounts" }).catch(() => []),
      provider.request({ method: "eth_chainId" }).catch(() => ""),
    ])
    const accounts = normalizeAccountsResponse(accountsResult)
    return {
      evmAvailable: true,
      evmAddress: accounts[0] || "",
      evmChainId: String(chainIdResult || "").trim().slice(0, 64),
    }
  } catch {
    return { evmAvailable: true, evmAddress: "", evmChainId: "" }
  }
}
