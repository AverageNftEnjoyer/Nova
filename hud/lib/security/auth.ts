import "server-only"

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"

const DATA_DIR = path.join(process.cwd(), "data")
const AUTH_FILE = path.join(DATA_DIR, "auth-config.json")
const SESSION_COOKIE_NAME = "nova_session"
const SESSION_HEADER_NAME = "x-nova-session"
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12
const DEV_FALLBACK_AUTH_SECRET = createHash("sha256")
  .update(`nova-dev-auth:${process.cwd()}`)
  .digest("hex")
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_LOCK_MS = 15 * 60 * 1000
const MAX_LOGIN_ATTEMPTS = 10

type AuthConfig = {
  passwordHash: string
  updatedAt: string
}

type SessionPayload = {
  sub: string
  sid: string
  iat: number
  exp: number
}

type LoginAttemptState = {
  failures: number
  firstFailureAt: number
  lockUntil: number
}

const loginAttemptMap = new Map<string, LoginAttemptState>()

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url")
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8")
}

function parseCookieHeader(cookieHeader: string | null, name: string): string {
  if (!cookieHeader) return ""
  const segments = cookieHeader.split(";")
  for (const segment of segments) {
    const [rawKey, ...rest] = segment.split("=")
    if (!rawKey) continue
    if (rawKey.trim() !== name) continue
    return rest.join("=").trim()
  }
  return ""
}

function getClientKey(request: Request): string {
  const forwarded = String(request.headers.get("x-forwarded-for") || "")
    .split(",")[0]
    ?.trim()
  if (forwarded) return forwarded
  return "local-client"
}

function parseScryptHash(serialized: string): {
  n: number
  r: number
  p: number
  salt: Buffer
  hash: Buffer
} | null {
  const parts = String(serialized || "").split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return null
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  const salt = Buffer.from(parts[4], "base64")
  const hash = Buffer.from(parts[5], "base64")
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return null
  if (!salt.length || !hash.length) return null
  return { n, r, p, salt, hash }
}

function hashPassword(plain: string): string {
  const n = 16384
  const r = 8
  const p = 1
  const salt = randomBytes(16)
  const derived = scryptSync(plain, salt, 64, { N: n, r, p })
  return `scrypt$${n}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`
}

function verifyPasswordWithHash(plain: string, serialized: string): boolean {
  const parsed = parseScryptHash(serialized)
  if (!parsed) return false
  const derived = scryptSync(plain, parsed.salt, parsed.hash.length, {
    N: parsed.n,
    r: parsed.r,
    p: parsed.p,
  })
  if (derived.length !== parsed.hash.length) return false
  return timingSafeEqual(derived, parsed.hash)
}

function getAuthSecret(): string {
  const configured = String(process.env.NOVA_AUTH_SECRET || "").trim()
  if (configured) return configured
  if (process.env.NODE_ENV === "production") {
    throw new Error("NOVA_AUTH_SECRET is required in production.")
  }
  return DEV_FALLBACK_AUTH_SECRET
}

function getSessionTtlSeconds(): number {
  const raw = Number(process.env.NOVA_AUTH_SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS)
  if (!Number.isFinite(raw) || raw < 300) return DEFAULT_SESSION_TTL_SECONDS
  return Math.floor(raw)
}

async function ensureAuthFile(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(AUTH_FILE, "utf8")
  } catch {
    // no-op; file is optional until setup
  }
}

async function loadFileAuthConfig(): Promise<AuthConfig | null> {
  await ensureAuthFile()
  try {
    const raw = await readFile(AUTH_FILE, "utf8")
    const parsed = JSON.parse(raw) as Partial<AuthConfig>
    const passwordHash = String(parsed.passwordHash || "").trim()
    if (!passwordHash) return null
    return {
      passwordHash,
      updatedAt: String(parsed.updatedAt || new Date().toISOString()),
    }
  } catch {
    return null
  }
}

async function saveFileAuthConfig(config: AuthConfig): Promise<void> {
  await ensureAuthFile()
  await writeFile(AUTH_FILE, JSON.stringify(config, null, 2), "utf8")
}

export async function readAuthPasswordHash(): Promise<string> {
  const envHash = String(process.env.NOVA_AUTH_PASSWORD_HASH || "").trim()
  if (envHash) return envHash
  const fileConfig = await loadFileAuthConfig()
  return fileConfig?.passwordHash || ""
}

export async function isAuthConfigured(): Promise<boolean> {
  const hash = await readAuthPasswordHash()
  return hash.length > 0
}

export async function setPasswordForLocalAuth(password: string): Promise<void> {
  const plain = String(password || "")
  if (plain.length < 12) throw new Error("Password must be at least 12 characters.")
  if (String(process.env.NOVA_AUTH_PASSWORD_HASH || "").trim()) {
    throw new Error("NOVA_AUTH_PASSWORD_HASH is set. Remove it to allow file-based password setup.")
  }
  await saveFileAuthConfig({
    passwordHash: hashPassword(plain),
    updatedAt: new Date().toISOString(),
  })
}

export async function verifyLoginPassword(password: string): Promise<boolean> {
  const hash = await readAuthPasswordHash()
  if (!hash) return false
  return verifyPasswordWithHash(String(password || ""), hash)
}

function signPayload(payload: SessionPayload): string {
  const body = toBase64Url(JSON.stringify(payload))
  const sig = createHmac("sha256", getAuthSecret()).update(body).digest("base64url")
  return `${body}.${sig}`
}

function parseAndVerifySignedPayload(token: string): SessionPayload | null {
  const [body, sig] = String(token || "").split(".")
  if (!body || !sig) return null
  const expected = createHmac("sha256", getAuthSecret()).update(body).digest("base64url")
  if (expected !== sig) return null
  try {
    const parsed = JSON.parse(fromBase64Url(body)) as SessionPayload
    if (!parsed || typeof parsed !== "object") return null
    if (!parsed.sub || !parsed.sid) return null
    if (!Number.isFinite(parsed.iat) || !Number.isFinite(parsed.exp)) return null
    if (parsed.exp <= nowSeconds()) return null
    return parsed
  } catch {
    return null
  }
}

export function createSessionToken(subject = "local-admin"): string {
  const iat = nowSeconds()
  const exp = iat + getSessionTtlSeconds()
  return signPayload({
    sub: subject,
    sid: randomBytes(16).toString("hex"),
    iat,
    exp,
  })
}

export function readSessionFromRequest(request: Request): SessionPayload | null {
  const cookieHeader = request.headers.get("cookie")
  const token = parseCookieHeader(cookieHeader, SESSION_COOKIE_NAME)
  if (token) {
    const fromCookie = parseAndVerifySignedPayload(token)
    if (fromCookie) return fromCookie
  }
  const headerToken = String(request.headers.get(SESSION_HEADER_NAME) || "").trim()
  if (!headerToken) return null
  return parseAndVerifySignedPayload(headerToken)
}

function buildCookieOptions() {
  const secure = process.env.NODE_ENV === "production"
  return {
    httpOnly: true,
    secure,
    sameSite: "strict" as const,
    path: "/",
  }
}

export function attachSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    ...buildCookieOptions(),
    maxAge: getSessionTtlSeconds(),
  })
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...buildCookieOptions(),
    maxAge: 0,
  })
}

function isSafeMethod(method: string): boolean {
  const normalized = String(method || "").toUpperCase()
  return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS"
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin")
  const referer = request.headers.get("referer")
  try {
    const targetUrl = new URL(request.url)
    if (origin) {
      const originUrl = new URL(origin)
      if (originUrl.protocol === targetUrl.protocol && originUrl.host === targetUrl.host) return true
    }
    if (referer) {
      const refererUrl = new URL(referer)
      if (refererUrl.protocol === targetUrl.protocol && refererUrl.host === targetUrl.host) return true
    }
    return false
  } catch {
    return false
  }
}

export async function requireApiSession(request: Request): Promise<NextResponse | null> {
  const requestUrl = new URL(request.url)
  const origin = request.headers.get("origin")
  const referer = request.headers.get("referer")
  const cookieHeader = request.headers.get("cookie") || ""
  const hasSessionCookie = cookieHeader.includes(`${SESSION_COOKIE_NAME}=`)

  const configured = await isAuthConfigured()
  if (!configured) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] not_configured", {
        path: requestUrl.pathname,
        method: request.method,
        origin,
        referer,
        hasSessionCookie,
      })
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Auth is not configured. Complete setup via /login.",
        reason: "not_configured",
        debug:
          process.env.NODE_ENV !== "production"
            ? {
                path: requestUrl.pathname,
                method: request.method,
                origin,
                referer,
                hasSessionCookie,
              }
            : undefined,
      },
      { status: 503 },
    )
  }

  const session = readSessionFromRequest(request)
  if (!session) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] unauthorized_no_session", {
        path: requestUrl.pathname,
        method: request.method,
        origin,
        referer,
        hasSessionCookie,
      })
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized.",
        reason: "no_session",
        debug:
          process.env.NODE_ENV !== "production"
            ? {
                path: requestUrl.pathname,
                method: request.method,
                origin,
                referer,
                hasSessionCookie,
              }
            : undefined,
      },
      { status: 401 },
    )
  }

  if (!isSafeMethod(request.method) && !isSameOriginRequest(request)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] invalid_origin", {
        path: requestUrl.pathname,
        method: request.method,
        origin,
        referer,
        expectedHost: requestUrl.host,
      })
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid request origin.",
        reason: "invalid_origin",
        debug:
          process.env.NODE_ENV !== "production"
            ? {
                path: requestUrl.pathname,
                method: request.method,
                origin,
                referer,
                expectedHost: requestUrl.host,
              }
            : undefined,
      },
      { status: 403 },
    )
  }

  return null
}

export function requireSameOriginMutation(request: Request): NextResponse | null {
  if (!isSafeMethod(request.method) && !isSameOriginRequest(request)) {
    return NextResponse.json({ ok: false, error: "Invalid request origin." }, { status: 403 })
  }
  return null
}

export function guardLoginRateLimit(request: Request): NextResponse | null {
  const key = getClientKey(request)
  const now = Date.now()
  const current = loginAttemptMap.get(key)
  if (!current) return null
  if (current.lockUntil > now) {
    const retryAfter = Math.ceil((current.lockUntil - now) / 1000)
    return NextResponse.json(
      {
        ok: false,
        error: "Too many login attempts. Try again later.",
        retryAfterSeconds: retryAfter,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    )
  }
  return null
}

export function registerLoginAttempt(request: Request, success: boolean): void {
  const key = getClientKey(request)
  if (success) {
    loginAttemptMap.delete(key)
    return
  }

  const now = Date.now()
  const current = loginAttemptMap.get(key)
  if (!current || now - current.firstFailureAt > LOGIN_WINDOW_MS) {
    loginAttemptMap.set(key, {
      failures: 1,
      firstFailureAt: now,
      lockUntil: 0,
    })
    return
  }

  const failures = current.failures + 1
  const lockUntil = failures >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCK_MS : 0
  loginAttemptMap.set(key, {
    failures,
    firstFailureAt: current.firstFailureAt,
    lockUntil,
  })
}
