// Single source of truth for every secret-bearing field of the IntegrationsConfig shape.
// Used by the HUD store (encrypt-on-save) and client masking.
// (toClientIntegrationsConfig), and the no-plaintext smoke. Adding a secret field to IntegrationsConfig without
// listing it here means it would be persisted unencrypted, so keep this list exhaustive.
//
// Path grammar: "a.b" nested key, "a[]" every element of array `a`, "*" every key of an object.

export const SECRET_FIELD_PATHS = Object.freeze([
  "telegram.botToken",
  "discord.webhookUrls[]",
  "slack.webhookUrl",
  "brave.apiKey",
  "news.apiKey",
  "coinbase.apiKey",
  "coinbase.apiSecret",
  "openai.apiKey",
  "claude.apiKey",
  "grok.apiKey",
  "gemini.apiKey",
  "spotify.accessTokenEnc",
  "spotify.refreshTokenEnc",
  "youtube.accessTokenEnc",
  "youtube.refreshTokenEnc",
  "gmail.oauthClientSecret",
  "gmail.accessTokenEnc",
  "gmail.refreshTokenEnc",
  "gmail.accounts[].accessTokenEnc",
  "gmail.accounts[].refreshTokenEnc",
  "gcalendar.accessTokenEnc",
  "gcalendar.refreshTokenEnc",
  "gcalendar.accounts[].accessTokenEnc",
  "gcalendar.accounts[].refreshTokenEnc",
  "agents.*.apiKey",
]);

const COMPILED_PATHS = SECRET_FIELD_PATHS.map((path) => path.split("."));

function visit(container, key, rest, trail, mapper) {
  if (rest.length === 0) {
    const current = container[key];
    if (typeof current === "string") container[key] = mapper(current, trail.join("."));
    return;
  }
  walk(container[key], rest, trail, mapper);
}

function walk(node, tokens, trail, mapper) {
  if (node === null || typeof node !== "object") return;
  const [head, ...rest] = tokens;
  if (head === "*") {
    for (const key of Object.keys(node)) visit(node, key, rest, [...trail, key], mapper);
    return;
  }
  const isArray = head.endsWith("[]");
  const key = isArray ? head.slice(0, -2) : head;
  if (!Object.prototype.hasOwnProperty.call(node, key)) return;
  if (!isArray) {
    visit(node, key, rest, [...trail, key], mapper);
    return;
  }
  const list = node[key];
  if (!Array.isArray(list)) return;
  for (let index = 0; index < list.length; index += 1) {
    visit(list, index, rest, [...trail, `${key}[${index}]`], mapper);
  }
}

/**
 * Returns a deep clone of `config` where every registered secret string was replaced by `mapper(value, path)`.
 * Empty strings are passed through the mapper too, so callers decide (usually `value ? ... : value`).
 */
export function mapSecretFields(config, mapper) {
  const clone = structuredClone(config);
  for (const tokens of COMPILED_PATHS) walk(clone, tokens, [], mapper);
  return clone;
}

/** Every non-empty secret string in `config` as `{ path, value }`. Values are returned in-memory only. */
export function collectSecretValues(config) {
  const found = [];
  mapSecretFields(config, (value, path) => {
    if (value) found.push({ path, value });
    return value;
  });
  return found;
}
