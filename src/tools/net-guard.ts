import { lookup } from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export type SsrfPolicy = {
  allowPrivateNetwork?: boolean;
  allowedHostnames?: string[];
  hostnameAllowlist?: string[];
};

function normalizeHostname(hostname: string): string {
  const normalized = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function parseStrictIpv4Octet(part: string): number | null {
  if (!/^[0-9]+$/.test(part)) {
    return null;
  }
  const value = Number.parseInt(part, 10);
  if (Number.isNaN(value) || value < 0 || value > 255) {
    return null;
  }
  if (part !== String(value)) {
    return null;
  }
  return value;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const out: number[] = [];
  for (const part of parts) {
    const value = parseStrictIpv4Octet(part);
    if (value === null) {
      return null;
    }
    out.push(value);
  }
  return out;
}

function classifyIpv4Part(part: string): "decimal" | "hex" | "invalid-hex" | "non-numeric" {
  if (/^0x[0-9a-f]+$/i.test(part)) return "hex";
  if (/^0x/i.test(part)) return "invalid-hex";
  if (/^[0-9]+$/.test(part)) return "decimal";
  return "non-numeric";
}

function isUnsupportedLegacyIpv4Literal(address: string): boolean {
  const parts = address.split(".");
  if (parts.length === 0 || parts.length > 4) {
    return false;
  }
  if (parts.some((part) => part.length === 0)) {
    return true;
  }

  const kinds = parts.map(classifyIpv4Part);
  if (kinds.some((kind) => kind === "non-numeric")) {
    return false;
  }
  if (kinds.some((kind) => kind === "invalid-hex")) {
    return true;
  }

  if (parts.length !== 4) {
    return true;
  }
  for (const part of parts) {
    if (/^0x/i.test(part)) {
      return true;
    }
    const value = Number.parseInt(part, 10);
    if (Number.isNaN(value) || value > 255 || part !== String(value)) {
      return true;
    }
  }
  return false;
}

function stripIpv6ZoneId(address: string): string {
  const index = address.indexOf("%");
  return index >= 0 ? address.slice(0, index) : address;
}

function parseIpv6Hextets(address: string): number[] | null {
  let input = stripIpv6ZoneId(address.trim().toLowerCase());
  if (!input) {
    return null;
  }

  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    if (lastColon < 0) {
      return null;
    }
    const ipv4 = parseIpv4(input.slice(lastColon + 1));
    if (!ipv4) {
      return null;
    }
    const high = (ipv4[0] << 8) + ipv4[1];
    const low = (ipv4[2] << 8) + ipv4[3];
    input = `${input.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const doubleColonParts = input.split("::");
  if (doubleColonParts.length > 2) {
    return null;
  }

  const headParts =
    doubleColonParts[0]?.length > 0 ? doubleColonParts[0].split(":").filter(Boolean) : [];
  const tailParts =
    doubleColonParts.length === 2 && doubleColonParts[1]?.length > 0
      ? doubleColonParts[1].split(":").filter(Boolean)
      : [];

  const missingParts = 8 - headParts.length - tailParts.length;
  if (missingParts < 0) {
    return null;
  }

  const fullParts =
    doubleColonParts.length === 1
      ? input.split(":")
      : [...headParts, ...Array.from({ length: missingParts }, () => "0"), ...tailParts];

  if (fullParts.length !== 8) {
    return null;
  }

  const hextets: number[] = [];
  for (const part of fullParts) {
    if (!part) {
      return null;
    }
    const value = Number.parseInt(part, 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) {
      return null;
    }
    hextets.push(value);
  }
  return hextets;
}

function decodeIpv4FromHextets(high: number, low: number): number[] {
  return [(high >>> 8) & 0xff, high & 0xff, (low >>> 8) & 0xff, low & 0xff];
}

type EmbeddedIpv4Rule = {
  matches: (hextets: number[]) => boolean;
  extract: (hextets: number[]) => [high: number, low: number];
};

const EMBEDDED_IPV4_RULES: EmbeddedIpv4Rule[] = [
  {
    matches: (h) =>
      h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && (h[5] === 0xffff || h[5] === 0),
    extract: (h) => [h[6], h[7]],
  },
  {
    matches: (h) =>
      h[0] === 0x0064 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0,
    extract: (h) => [h[6], h[7]],
  },
  {
    matches: (h) =>
      h[0] === 0x0064 && h[1] === 0xff9b && h[2] === 0x0001 && h[3] === 0 && h[4] === 0 && h[5] === 0,
    extract: (h) => [h[6], h[7]],
  },
  {
    matches: (h) => h[0] === 0x2002,
    extract: (h) => [h[1], h[2]],
  },
  {
    matches: (h) => h[0] === 0x2001 && h[1] === 0x0000,
    extract: (h) => [h[6] ^ 0xffff, h[7] ^ 0xffff],
  },
  {
    matches: (h) => (h[4] & 0xfcff) === 0 && h[5] === 0x5efe,
    extract: (h) => [h[6], h[7]],
  },
];

function extractIpv4FromEmbeddedIpv6(hextets: number[]): number[] | null {
  for (const rule of EMBEDDED_IPV4_RULES) {
    if (!rule.matches(hextets)) continue;
    const [high, low] = rule.extract(hextets);
    return decodeIpv4FromHextets(high, low);
  }
  return null;
}

function isPrivateIpv4Parts(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isPrivateIpAddress(address: string): boolean {
  let normalized = normalizeHostname(address);
  if (!normalized) return false;

  if (normalized.includes(":")) {
    const hextets = parseIpv6Hextets(normalized);
    if (!hextets) {
      return true;
    }
    const isUnspecified =
      hextets[0] === 0 &&
      hextets[1] === 0 &&
      hextets[2] === 0 &&
      hextets[3] === 0 &&
      hextets[4] === 0 &&
      hextets[5] === 0 &&
      hextets[6] === 0 &&
      hextets[7] === 0;
    const isLoopback =
      hextets[0] === 0 &&
      hextets[1] === 0 &&
      hextets[2] === 0 &&
      hextets[3] === 0 &&
      hextets[4] === 0 &&
      hextets[5] === 0 &&
      hextets[6] === 0 &&
      hextets[7] === 1;
    if (isUnspecified || isLoopback) {
      return true;
    }

    const embeddedIpv4 = extractIpv4FromEmbeddedIpv6(hextets);
    if (embeddedIpv4) {
      return isPrivateIpv4Parts(embeddedIpv4);
    }

    const first = hextets[0];
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
    return false;
  }

  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    return isPrivateIpv4Parts(ipv4);
  }
  if (isUnsupportedLegacyIpv4Literal(normalized)) {
    return true;
  }
  return false;
}

function isBlockedHostnameNormalized(normalized: string): boolean {
  if (!normalized) return false;
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (normalized.endsWith(".localhost")) return true;
  if (normalized.endsWith(".local")) return true;
  if (normalized.endsWith(".internal")) return true;
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return isBlockedHostnameNormalized(normalized);
}

export function isBlockedHostnameOrIp(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return false;
  return isBlockedHostnameNormalized(normalized) || isPrivateIpAddress(normalized);
}

function normalizeHostnameSet(values?: string[]): Set<string> {
  if (!values || values.length === 0) return new Set<string>();
  return new Set(values.map((value) => normalizeHostname(value)).filter(Boolean));
}

function normalizeHostnameAllowlist(values?: string[]): string[] {
  if (!values || values.length === 0) return [];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeHostname(value))
        .filter((value) => value !== "*" && value !== "*." && value.length > 0),
    ),
  );
}

function isHostnameAllowedByPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    if (!suffix || hostname === suffix) return false;
    return hostname.endsWith(`.${suffix}`);
  }
  return hostname === pattern;
}

function matchesHostnameAllowlist(hostname: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  return allowlist.some((pattern) => isHostnameAllowedByPattern(hostname, pattern));
}

async function assertSafeUrlTarget(rawUrl: string, policy?: SsrfPolicy): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed.");
  }

  const hostname = normalizeHostname(parsed.hostname);
  const allowPrivateNetwork = Boolean(policy?.allowPrivateNetwork);
  const allowedHostnames = normalizeHostnameSet(policy?.allowedHostnames);
  const hostnameAllowlist = normalizeHostnameAllowlist(policy?.hostnameAllowlist);
  const isExplicitAllowed = allowedHostnames.has(hostname);

  if (!matchesHostnameAllowlist(hostname, hostnameAllowlist)) {
    throw new SsrfBlockedError(`Blocked hostname (not in allowlist): ${hostname}`);
  }

  if (!allowPrivateNetwork && !isExplicitAllowed && isBlockedHostnameOrIp(hostname)) {
    throw new SsrfBlockedError(`Blocked hostname or private/internal IP address: ${hostname}`);
  }

  if (net.isIP(hostname)) {
    if (!allowPrivateNetwork && !isExplicitAllowed && isPrivateIpAddress(hostname)) {
      throw new SsrfBlockedError(`Blocked private IP target: ${hostname}`);
    }
    return parsed;
  }

  const dnsResults = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!dnsResults.length) {
    throw new Error(`Failed to resolve hostname: ${hostname}`);
  }
  if (!allowPrivateNetwork && !isExplicitAllowed) {
    for (const resolved of dnsResults) {
      if (isPrivateIpAddress(resolved.address)) {
        throw new SsrfBlockedError(`Blocked private DNS resolution for ${hostname}: ${resolved.address}`);
      }
    }
  }

  return parsed;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function withTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
  controller: AbortController;
} {
  const controller = new AbortController();
  const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 15_000;
  const timer = setTimeout(() => controller.abort(), safeTimeout);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
    controller,
  };
}

function bindAbortRelay(controller: AbortController, upstream?: AbortSignal | null): () => void {
  if (!upstream) {
    return () => {};
  }
  if (upstream.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => controller.abort();
  upstream.addEventListener("abort", onAbort, { once: true });
  return () => upstream.removeEventListener("abort", onAbort);
}

export async function fetchWithSsrfGuard(params: {
  url: string;
  init?: RequestInit;
  timeoutMs?: number;
  maxRedirects?: number;
  policy?: SsrfPolicy;
  signal?: AbortSignal;
  auditContext?: string;
}): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects =
    Number.isFinite(params.maxRedirects) && (params.maxRedirects as number) >= 0
      ? Math.floor(params.maxRedirects as number)
      : 3;
  const visited = new Set<string>();
  let currentUrl = params.url;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const parsed = await assertSafeUrlTarget(currentUrl, params.policy);
    const timeout = withTimeoutSignal(params.timeoutMs ?? 15_000);
    const unbindAbort = bindAbortRelay(timeout.controller, params.signal ?? params.init?.signal);
    try {
      const response = await fetch(parsed.toString(), {
        ...(params.init || {}),
        redirect: "manual",
        signal: timeout.signal,
      });

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect missing location header (${response.status}).`);
        }
        const nextUrl = new URL(location, parsed).toString();
        if (visited.has(nextUrl)) {
          throw new Error("Redirect loop detected.");
        }
        visited.add(nextUrl);
        currentUrl = nextUrl;
        continue;
      }

      return {
        response,
        finalUrl: response.url || parsed.toString(),
      };
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        const context = String(params.auditContext || "url-fetch");
        console.warn(
          `[Security] blocked URL fetch context=${context} target=${parsed.origin}${parsed.pathname} reason=${err.message}`,
        );
      }
      throw err;
    } finally {
      unbindAbort();
      timeout.cleanup();
    }
  }

  throw new Error(`Too many redirects (limit: ${maxRedirects}).`);
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 2_000_000;
  const body = response.body;

  if (!body || typeof body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > limit) {
      throw new Error(`Response exceeds size limit (${limit} bytes).`);
    }
    return text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;

    bytesRead += value.byteLength;
    if (bytesRead > limit) {
      try {
        await reader.cancel();
      } catch {
        // Best-effort cancellation.
      }
      throw new Error(`Response exceeds size limit (${limit} bytes).`);
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}
