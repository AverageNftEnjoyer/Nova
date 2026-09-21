/**
 * Provider base URL policy. A stored provider API key must only ever be sent to the base URL the user saved (or the
 * provider default), never to a URL that arrived with an arbitrary request. A caller-supplied base URL is honoured only
 * together with a caller-supplied key typed in the same request (the "test this key" flow), and every base URL that
 * is accepted from a request (probe or config PATCH) must pass `validateProviderBaseUrl`.
 *
 * No `server-only` / `@/` imports so smokes can transpile it. Set NOVA_ALLOW_LOCAL_PROVIDER_BASE_URL=1 (server env,
 * never request-controlled) to permit http and private/loopback hosts for a local gateway such as LiteLLM or Ollama.
 */
import net from "node:net"

/** IPv4 in a private, loopback, link-local, CGNAT, benchmarking, multicast or reserved range (dotted-quad input). */
function isNonPublicIpv4(address: string): boolean {
  const [a, b, c] = address.split(".").map((part) => Number.parseInt(part, 10))
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0 && c === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  return false
}

function isNonPublicIpv6(address: string): boolean {
  const lower = address.toLowerCase()
  if (lower === "::" || lower === "::1") return true
  // IPv4-mapped / NAT64: URL parsing yields hex groups (::ffff:7f00:1); decode them and judge the embedded IPv4.
  const mapped = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
  if (mapped) {
    const hi = Number.parseInt(mapped[1], 16)
    const lo = Number.parseInt(mapped[2], 16)
    return isNonPublicIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(lower)) return isNonPublicIpv4(lower.slice("::ffff:".length))
  const first = Number.parseInt(lower.split(":")[0] || "0", 16)
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true // multicast
  return false
}

/** Hostname is a local/private name or IP literal. WHATWG URL parsing already canonicalises hex/decimal IPv4 forms. */
function isNonPublicHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "")
  if (!host) return true
  const kind = net.isIP(host)
  if (kind === 4) return isNonPublicIpv4(host)
  if (kind === 6) return isNonPublicIpv6(host)
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localdomain") ||
    !host.includes(".")
  )
}

export type ProviderBaseUrlValidation = { ok: true; url: string } | { ok: false; error: string }

function allowLocalProviderBaseUrl(): boolean {
  const raw = String(process.env.NOVA_ALLOW_LOCAL_PROVIDER_BASE_URL || "").trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

/** Trim, drop trailing slashes, and require a safe https URL (no userinfo/query/fragment, no private host). */
export function validateProviderBaseUrl(raw: string): ProviderBaseUrlValidation {
  const trimmed = String(raw || "").trim()
  if (!trimmed) return { ok: false, error: "Base URL is required." }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, error: "Base URL is not a valid URL." }
  }
  const allowLocal = allowLocalProviderBaseUrl()
  if (url.protocol !== "https:" && !(allowLocal && url.protocol === "http:")) {
    return { ok: false, error: "Base URL must use https." }
  }
  if (url.username || url.password) return { ok: false, error: "Base URL must not contain credentials." }
  if (url.search || url.hash) return { ok: false, error: "Base URL must not contain a query string or fragment." }
  if (!allowLocal && isNonPublicHost(url.hostname)) {
    return { ok: false, error: "Base URL must be a public host (private, loopback and link-local addresses are not allowed)." }
  }
  return { ok: true, url: `${url.origin}${url.pathname}`.replace(/\/+$/, "") }
}

function sameBaseUrl(a: string, b: string): boolean {
  const norm = (value: string) => String(value || "").trim().replace(/\/+$/, "").toLowerCase()
  return norm(a) === norm(b)
}

export type ProviderProbeInput = {
  /** Values from the request body (untrusted). */
  callerApiKey: unknown
  callerBaseUrl: unknown
  /** Values from the stored (decrypted) integration config. */
  storedApiKey: string
  storedBaseUrl: string
  /** Provider default used when nothing is stored. */
  defaultBaseUrl: string
}

export type ProviderProbeTarget =
  | { ok: true; apiKey: string; baseUrl: string }
  | { ok: false; status: number; error: string }

/**
 * Decide which key and base URL a model probe may use.
 * - Caller key present: the key is the caller's; a caller base URL must validate, otherwise the stored/default URL is used.
 * - No caller key: the stored key is used and ONLY with the stored/default base URL. A caller base URL that differs from
 *   it is refused (400) instead of being honoured or silently ignored.
 */
export function resolveProviderProbeTarget(input: ProviderProbeInput): ProviderProbeTarget {
  const callerKey = typeof input.callerApiKey === "string" ? input.callerApiKey.trim() : ""
  const callerBase = typeof input.callerBaseUrl === "string" ? input.callerBaseUrl.trim() : ""
  const storedKey = String(input.storedApiKey || "").trim()
  const storedBase = String(input.storedBaseUrl || "").trim() || input.defaultBaseUrl

  if (callerKey) {
    if (!callerBase || sameBaseUrl(callerBase, storedBase)) return { ok: true, apiKey: callerKey, baseUrl: storedBase }
    const validated = validateProviderBaseUrl(callerBase)
    if (!validated.ok) return { ok: false, status: 400, error: validated.error }
    return { ok: true, apiKey: callerKey, baseUrl: validated.url }
  }

  if (callerBase && !sameBaseUrl(callerBase, storedBase)) {
    return {
      ok: false,
      status: 400,
      error: "Enter the API key to test a different base URL. Saved keys are only used with the saved base URL.",
    }
  }
  return { ok: true, apiKey: storedKey, baseUrl: storedBase }
}
