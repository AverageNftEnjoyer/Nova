import crypto from "node:crypto";

import type { CoinbaseAuthStrategy, CoinbaseAuthBuildInput } from "./types.js";

function toBase64Url(input: Buffer | string): string {
  const encoded = Buffer.isBuffer(input) ? input.toString("base64") : Buffer.from(input, "utf8").toString("base64");
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizePrivateKeyPem(raw: string): string {
  const key = String(raw || "").trim().replace(/\\n/g, "\n").trim();
  if (!key) return "";
  if (key.includes("BEGIN EC PRIVATE KEY") || key.includes("BEGIN PRIVATE KEY")) return key;
  return "";
}

function tryConvertSecretStringToPrivateKeyPem(raw: string): string {
  const compact = String(raw || "").trim().replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) return "";
  let decoded: Buffer;
  try {
    decoded = Buffer.from(compact, "base64");
  } catch {
    return "";
  }
  if (!decoded || decoded.length < 16) return "";
  const attempts: Array<() => crypto.KeyObject> = [
    () => crypto.createPrivateKey({ key: decoded, format: "der", type: "pkcs8" }),
    () => crypto.createPrivateKey({ key: decoded, format: "der", type: "sec1" }),
  ];
  for (const build of attempts) {
    try {
      const keyObj = build();
      return keyObj.export({ format: "pem", type: "pkcs8" }).toString();
    } catch {
      // continue
    }
  }
  return "";
}

function decodeHmacSecret(raw: string): Buffer {
  const compact = String(raw || "").trim().replace(/\s+/g, "");
  if (!compact) return Buffer.alloc(0);
  if (/^[A-Za-z0-9+/=]+$/.test(compact)) {
    try {
      const decoded = Buffer.from(compact, "base64");
      if (decoded.length > 0) return decoded;
    } catch {
      // fallback below
    }
  }
  return Buffer.from(compact, "utf8");
}

function buildCoinbaseJwt(input: {
  apiKey: string;
  privateKeyPem: string;
  method: string;
  pathWithQuery: string;
  host: string;
  nowMs: number;
}): string {
  const nbf = Math.floor(input.nowMs / 1000);
  const exp = nbf + 120;
  const header = {
    alg: "ES256",
    kid: input.apiKey,
    typ: "JWT",
    nonce: crypto.randomUUID().replace(/-/g, ""),
  };
  const payload = {
    iss: "cdp",
    sub: input.apiKey,
    nbf,
    exp,
    uri: `${input.method.toUpperCase()} ${input.host}${input.pathWithQuery}`,
  };
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
  const signature = crypto.createSign("SHA256").update(signingInput).end().sign(input.privateKeyPem);
  return `${signingInput}.${toBase64Url(signature)}`;
}

function buildHmacHeaders(input: {
  apiKey: string;
  apiSecret: string;
  method: string;
  pathWithQuery: string;
  bodyText?: string;
}): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const prehash = `${timestamp}${input.method.toUpperCase()}${input.pathWithQuery}${String(input.bodyText || "")}`;
  const secretBytes = decodeHmacSecret(input.apiSecret);
  const signature = crypto.createHmac("sha256", secretBytes).update(prehash).digest("base64");
  return {
    "CB-ACCESS-KEY": input.apiKey,
    "CB-ACCESS-SIGN": signature,
    "CB-ACCESS-TIMESTAMP": timestamp,
  };
}

export function createCoinbaseAutoAuthStrategy(params?: { host?: string }): CoinbaseAuthStrategy {
  const host = String(params?.host || "api.coinbase.com").trim() || "api.coinbase.com";
  return {
    name: "coinbase_auto_auth",
    async buildHeaders(input: CoinbaseAuthBuildInput): Promise<Record<string, string>> {
      const apiKey = String(input.credentials?.apiKey || "").trim();
      const apiSecret = String(input.credentials?.apiSecret || "").trim();
      if (!apiKey || !apiSecret) return {};

      const queryText = input.query && String(input.query.toString() || "").trim()
        ? `?${input.query.toString()}`
        : "";
      const pathWithQuery = `${String(input.path || "").trim() || "/"}${queryText}`;

      const normalizedPem = normalizePrivateKeyPem(apiSecret);
      const derivedPem = normalizedPem || tryConvertSecretStringToPrivateKeyPem(apiSecret);
      if (derivedPem) {
        const token = buildCoinbaseJwt({
          apiKey,
          privateKeyPem: derivedPem,
          method: String(input.method || "GET"),
          pathWithQuery,
          host,
          nowMs: Number(input.timestampMs || Date.now()),
        });
        return {
          Authorization: `Bearer ${token}`,
        };
      }

      return buildHmacHeaders({
        apiKey,
        apiSecret,
        method: String(input.method || "GET"),
        pathWithQuery,
        bodyText: input.bodyText,
      });
    },
  };
}

