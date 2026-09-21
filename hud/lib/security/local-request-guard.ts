/**
 * Request guard for the local-only HUD API (`/api/**`), enforced by `hud/proxy.ts`.
 *
 * The HUD listens on 127.0.0.1 and has no login: the trust boundary is "a process/page on this PC". A web page the user
 * happens to visit can still make their browser call `http://localhost:3000/api/...` (CORS only limits *reading* the
 * response, not sending a "simple" POST) and DNS rebinding can make a hostile name resolve to 127.0.0.1. Two checks close that:
 *
 *  1. Host header must be a loopback name (localhost, 127.0.0.1, [::1])            -> DNS-rebinding defense, all methods.
 *  2. For unsafe methods (POST/PUT/PATCH/DELETE), a present Origin must be a loopback origin on the SAME port as the
 *     request Host, and a present Sec-Fetch-Site must be `same-origin` or `none`.  -> cross-site request forgery defense.
 *
 * Requests with no Origin and no Sec-Fetch-Site are non-browser clients (the agent runtime's server-side fetches, Electron
 * main process, curl, smokes) and are allowed: a browser always sends Origin on cross-origin unsafe requests.
 * Safe methods (GET/HEAD/OPTIONS) skip check 2 because OAuth providers legitimately redirect the browser to the
 * `/api/.../callback` GET routes from another site; their responses are unreadable cross-origin.
 *
 * Pure functions, no `server-only` / `@/` imports, so smokes can transpile this file directly.
 */

export type LocalRequestGuardInput = {
  method: string
  host: string | null
  origin: string | null
  secFetchSite: string | null
}

export type LocalRequestGuardDecision =
  | { ok: true }
  | { ok: false; reason: "host" | "origin" | "fetch-site" }

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"])
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

type HostParts = { hostname: string; port: string }

function parseHostHeader(value: string | null | undefined): HostParts | null {
  const raw = String(value ?? "").trim().toLowerCase()
  if (!raw) return null
  // Only a bare host[:port]: no userinfo, path, whitespace or comma-joined proxy values.
  if (/[\s/@\,]/.test(raw)) return null
  const bracket = /^(\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/.exec(raw)
  if (bracket) return { hostname: bracket[1], port: bracket[2] ?? "" }
  const plain = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(raw)
  if (plain) return { hostname: plain[1], port: plain[2] ?? "" }
  return null
}

export function isLoopbackHostHeader(value: string | null | undefined): boolean {
  const parsed = parseHostHeader(value)
  return parsed !== null && LOOPBACK_HOSTNAMES.has(parsed.hostname)
}

function parseOrigin(value: string): { protocol: string; hostname: string; port: string } | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.username || url.password) return null
    return {
      protocol: url.protocol,
      hostname: url.hostname.toLowerCase(),
      port: url.port || (url.protocol === "https:" ? "443" : "80"),
    }
  } catch {
    return null
  }
}

export function evaluateLocalRequest(input: LocalRequestGuardInput): LocalRequestGuardDecision {
  const host = parseHostHeader(input.host)
  if (!host || !LOOPBACK_HOSTNAMES.has(host.hostname)) return { ok: false, reason: "host" }

  const method = String(input.method || "").trim().toUpperCase()
  if (SAFE_METHODS.has(method)) return { ok: true }

  const origin = String(input.origin ?? "").trim()
  if (origin) {
    const parsed = parseOrigin(origin)
    if (!parsed || !LOOPBACK_HOSTNAMES.has(bracketIfIpv6(parsed.hostname))) return { ok: false, reason: "origin" }
    const hostPort = host.port || (parsed.protocol === "https:" ? "443" : "80")
    if (parsed.port !== hostPort) return { ok: false, reason: "origin" }
  }

  const fetchSite = String(input.secFetchSite ?? "").trim().toLowerCase()
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return { ok: false, reason: "fetch-site" }

  return { ok: true }
}

function bracketIfIpv6(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname
}
