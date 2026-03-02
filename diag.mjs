import { createDecipheriv } from "crypto";
import fs from "fs";
import path from "path";

const WORKSPACE_ROOT = path.resolve(process.env.NOVA_ROOT || process.cwd());
const USER_CONTEXT_ID = String(
  process.env.NOVA_USER_CONTEXT_ID || process.argv[2] || "",
).trim();
if (!USER_CONTEXT_ID) {
  throw new Error("Missing user context id. Use NOVA_USER_CONTEXT_ID or pass it as the first argument.");
}

const ROOT_ENV = path.join(WORKSPACE_ROOT, ".env");
const GLOBAL_CONFIG = path.join(WORKSPACE_ROOT, "hud", "data", "integrations-config.json");
const USER_CONFIG = path.join(
  WORKSPACE_ROOT,
  ".agent",
  "user-context",
  USER_CONTEXT_ID,
  "integrations-config.json",
);

function readEnvKey(filePath, keyName) {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const l of lines) {
      if (l.startsWith(keyName + "=")) return l.slice(keyName.length + 1).trim();
    }
  } catch {}
  return "";
}

function decrypt(encryptedKey, keyBuf) {
  const parts = encryptedKey.split(".");
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const enc = Buffer.from(parts[2], "base64");
  const d = createDecipheriv("aes-256-gcm", keyBuf, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

const envKey = readEnvKey(ROOT_ENV, "NOVA_ENCRYPTION_KEY");
const envKeyBuf = Buffer.from(envKey, "base64");

// Decrypt the user-scoped key
const userConfig = JSON.parse(fs.readFileSync(USER_CONFIG, "utf8"));
const decryptedApiKey = decrypt(userConfig.openai.apiKey, envKeyBuf);

// Update global config
const globalConfig = JSON.parse(fs.readFileSync(GLOBAL_CONFIG, "utf8"));
globalConfig.openai.apiKey = decryptedApiKey;
globalConfig.openai.connected = true;
globalConfig.openai.defaultModel = userConfig.openai.defaultModel;
globalConfig.activeLlmProvider = "openai";
globalConfig.updatedAt = new Date().toISOString();

fs.writeFileSync(GLOBAL_CONFIG, JSON.stringify(globalConfig, null, 2), "utf8");
console.log("Global config updated. Key starts with:", decryptedApiKey.slice(0, 12) + "...");
console.log("Model:", globalConfig.openai.defaultModel);
