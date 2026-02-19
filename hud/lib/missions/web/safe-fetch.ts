import "server-only"

import { lookup } from "node:dns/promises"
import net from "node:net"

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
])

function normalizeHostname(hostname: string): string {
  const normalized = String(hostname || "").trim().toLowerCase().replace(/\.$/, "")
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1)
  }
  return normalized
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false
  }
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isPrivateIpv6(address: string): boolean {
  const normalized = normalizeHostname(address)
  if (!normalized) return false
  if (normalized === "::" || normalized === "::1") return true

  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length))
  }

  const first = normalized.split(":")[0] || ""
  const firstHextet = Number.parseInt(first, 16)
  if (!Number.isNaN(firstHextet)) {
    if ((firstHextet & 0xfe00) === 0xfc00) return true
    if ((firstHextet & 0xffc0) === 0xfe80) return true
  }
  return false
}

function isPrivateIpAddress(address: string): boolean {
  const normalized = normalizeHostname(address)
  const family = net.isIP(normalized)
  if (family === 4) return isPrivateIpv4(normalized)
  if (family === 6) return isPrivateIpv6(normalized)
  return false
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return true
  if (BLOCKED_HOSTNAMES.has(normalized)) return true
  if (normalized.endsWith(".local")) return true
  if (normalized.endsWith(".internal")) return true
  return false
}

async function assertSafeUrlTarget(rawUrl: string): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("Invalid URL.")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed.")
  }

  const hostname = normalizeHostname(parsed.hostname)
  if (isBlockedHostname(hostname)) {
    throw new Error(`Blocked hostname: ${hostname}`)
  }

  if (net.isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      throw new Error(`Blocked private IP target: ${hostname}`)
    }
    return parsed
  }

  const dnsResults = await lookup(hostname, { all: true, verbatim: true }).catch(() => [])
  if (!dnsResults.length) {
    throw new Error(`Failed to resolve hostname: ${hostname}`)
  }
  for (const resolved of dnsResults) {
    if (isPrivateIpAddress(resolved.address)) {
      throw new Error(`Blocked private DNS resolution for ${hostname}: ${resolved.address}`)
    }
  }

  return parsed
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 15000
  const timer = setTimeout(() => controller.abort(), safeTimeout)
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  }
}

export async function fetchWithSsrfGuard(params: {
  url: string
  init?: RequestInit
  timeoutMs?: number
  maxRedirects?: number
}): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects =
    Number.isFinite(params.maxRedirects) && (params.maxRedirects as number) >= 0
      ? Math.floor(params.maxRedirects as number)
      : 3
  const visited = new Set<string>()
  let currentUrl = params.url

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const parsed = await assertSafeUrlTarget(currentUrl)
    const timeout = withTimeoutSignal(params.timeoutMs ?? 15000)
    try {
      const response = await fetch(parsed.toString(), {
        ...(params.init || {}),
        redirect: "manual",
        signal: timeout.signal,
      })

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location")
        if (!location) {
          throw new Error(`Redirect missing location header (${response.status}).`)
        }
        const nextUrl = new URL(location, parsed).toString()
        if (visited.has(nextUrl)) {
          throw new Error("Redirect loop detected.")
        }
        visited.add(nextUrl)
        currentUrl = nextUrl
        continue
      }

      return {
        response,
        finalUrl: response.url || parsed.toString(),
      }
    } finally {
      timeout.cleanup()
    }
  }

  throw new Error(`Too many redirects (limit: ${maxRedirects}).`)
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 2_000_000
  const body = response.body

  if (!body || typeof body.getReader !== "function") {
    const text = await response.text()
    if (Buffer.byteLength(text, "utf8") > limit) {
      throw new Error(`Response exceeds size limit (${limit} bytes).`)
    }
    return text
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let text = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value || value.byteLength === 0) continue

    bytesRead += value.byteLength
    if (bytesRead > limit) {
      try {
        await reader.cancel()
      } catch {
        // Best-effort cancellation.
      }
      throw new Error(`Response exceeds size limit (${limit} bytes).`)
    }

    text += decoder.decode(value, { stream: true })
  }

  text += decoder.decode()
  return text
}
