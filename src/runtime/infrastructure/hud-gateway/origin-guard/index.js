// Upgrade-time checks for the local HUD WebSocket gateway (127.0.0.1:8765).
//
// Browsers do not apply the same-origin policy to WebSockets, so any web page the user visits could otherwise open
// ws://127.0.0.1:8765 and drive the agent. Two checks close that:
//   1. Host must be a loopback name (DNS-rebinding defense).
//   2. When an Origin header is present (browsers always send one), it must be an allowed local HUD origin.
// Non-browser clients (the runtime's own tools, smokes, `ws` CLI) send no Origin and stay allowed.
// Pure functions only: no I/O, so they are unit-testable without starting a server.

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DEFAULT_HUD_PORT = "3000";

function splitHostHeader(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  // Reject anything that is not a bare host[:port] (userinfo, paths, whitespace, commas from proxies).
  if (/[\s/@\,]/.test(raw)) return null;
  const bracket = /^(\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/.exec(raw);
  if (bracket) return { hostname: bracket[1], port: bracket[2] || "" };
  const plain = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(raw);
  if (plain) return { hostname: plain[1], port: plain[2] || "" };
  return null;
}

export function isLoopbackHostHeader(hostHeader) {
  const parsed = splitHostHeader(hostHeader);
  return Boolean(parsed && LOOPBACK_HOSTNAMES.has(parsed.hostname));
}

function parseOrigin(origin) {
  try {
    const url = new URL(String(origin || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const defaultPort = url.protocol === "https:" ? "443" : "80";
    return { protocol: url.protocol, hostname: url.hostname.toLowerCase(), port: url.port || defaultPort };
  } catch {
    return null;
  }
}

/**
 * Origins allowed to open the gateway socket: http(s) on localhost / 127.0.0.1 / [::1] at the HUD port(s).
 * Ports come from NOVA_HUD_PORT and PORT (comma-separated allowed), defaulting to 3000. Extra full origins can be
 * added with NOVA_WS_ALLOWED_ORIGINS (comma-separated), e.g. for a reverse-proxied HUD.
 */
export function resolveAllowedHudOrigins(env = process.env) {
  const ports = new Set([DEFAULT_HUD_PORT]);
  for (const key of ["NOVA_HUD_PORT", "PORT"]) {
    for (const part of String(env?.[key] || "").split(",")) {
      const port = part.trim();
      if (/^\d{1,5}$/.test(port)) ports.add(String(Number.parseInt(port, 10)));
    }
  }
  const origins = new Set();
  for (const port of ports) {
    for (const host of LOOPBACK_HOSTNAMES) origins.add(`http://${host}:${port}`);
  }
  for (const part of String(env?.NOVA_WS_ALLOWED_ORIGINS || "").split(",")) {
    const normalized = normalizeOrigin(part.trim());
    if (normalized) origins.add(normalized);
  }
  return origins;
}

function normalizeOrigin(origin) {
  const parsed = parseOrigin(origin);
  if (!parsed) return "";
  const defaultPort = parsed.protocol === "https:" ? "443" : "80";
  return `${parsed.protocol}//${parsed.hostname}${parsed.port === defaultPort ? "" : `:${parsed.port}`}`;
}

/**
 * Decide whether a WebSocket upgrade may proceed.
 * @param {{ origin?: string, host?: string }} input  raw Origin and Host header values
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: true } | { ok: false, reason: "host" | "origin" }}
 */
export function checkGatewayUpgrade(input, env = process.env) {
  const host = input?.host;
  if (host !== undefined && host !== null && String(host).trim() !== "" && !isLoopbackHostHeader(host)) {
    return { ok: false, reason: "host" };
  }
  const origin = input?.origin;
  if (origin === undefined || origin === null || origin === "") return { ok: true };
  const normalized = normalizeOrigin(origin);
  if (!normalized || !resolveAllowedHudOrigins(env).has(normalized)) return { ok: false, reason: "origin" };
  return { ok: true };
}

/** Build the `ws` verifyClient callback. Logs one line per rejection, never payloads or header values. */
export function createGatewayVerifyClient(options = {}) {
  const env = options.env || process.env;
  const log = typeof options.log === "function" ? options.log : (line) => console.warn(line);
  return (info, done) => {
    const headers = info?.req?.headers || {};
    const decision = checkGatewayUpgrade({ origin: info?.origin ?? headers.origin, host: headers.host }, env);
    if (decision.ok) {
      done(true);
      return;
    }
    log(`[Gateway] Rejected WebSocket upgrade: disallowed ${decision.reason}.`);
    done(false, 403, "Forbidden");
  };
}
