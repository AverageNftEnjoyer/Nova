import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type KeyEntry = {
  keyId: string;
  material: Buffer;
};

export interface EncryptedTokenEnvelope {
  keyId: string;
  payload: string;
}

function toNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function deriveKeyMaterial(raw: string): Buffer {
  try {
    const maybe = Buffer.from(raw, "base64");
    if (maybe.length === 32) return maybe;
  } catch {
    // ignore and fall through
  }
  return createHash("sha256").update(raw).digest();
}

function loadRawKeyRing(): string[] {
  const fromRing = toNonEmptyString(process.env.NOVA_COINBASE_TOKEN_KEYS);
  if (fromRing) {
    return fromRing
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  const fallback = toNonEmptyString(process.env.NOVA_ENCRYPTION_KEY);
  return fallback ? [fallback] : [];
}

function loadKeyEntries(): KeyEntry[] {
  return loadRawKeyRing().map((raw, index) => ({
    keyId: `k${index + 1}`,
    material: deriveKeyMaterial(raw),
  }));
}

export function encryptTokenForStorage(plainText: string): EncryptedTokenEnvelope | null {
  const value = toNonEmptyString(plainText);
  if (!value) return null;
  const keyEntries = loadKeyEntries();
  if (keyEntries.length === 0) return null;
  const active = keyEntries[0];
  if (!active) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", active.material, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    keyId: active.keyId,
    payload: `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`,
  };
}

export function decryptTokenFromStorage(envelope: EncryptedTokenEnvelope | null): string {
  if (!envelope) return "";
  const payload = toNonEmptyString(envelope.payload);
  if (!payload) return "";
  const keyId = toNonEmptyString(envelope.keyId);
  const parts = payload.split(".");
  if (parts.length !== 3) return "";
  const [ivRaw, tagRaw, encRaw] = parts;
  const iv = Buffer.from(ivRaw || "", "base64");
  const tag = Buffer.from(tagRaw || "", "base64");
  const enc = Buffer.from(encRaw || "", "base64");
  if (iv.length !== 12 || tag.length !== 16 || enc.length === 0) return "";

  const keyEntries = loadKeyEntries();
  const ordered = keyId
    ? [...keyEntries.filter((entry) => entry.keyId === keyId), ...keyEntries.filter((entry) => entry.keyId !== keyId)]
    : keyEntries;

  for (const entry of ordered) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", entry.material, iv);
      decipher.setAuthTag(tag);
      const output = Buffer.concat([decipher.update(enc), decipher.final()]);
      return output.toString("utf8");
    } catch {
      // try next key
    }
  }
  return "";
}

