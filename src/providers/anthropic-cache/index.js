// Anthropic prompt-caching helpers (token-efficiency Stage 1).
//
// Anthropic caches nothing unless a request marks cache breakpoints with `cache_control`
// (platform.claude.com/docs/en/build-with-claude/prompt-caching, read 2026-09-23):
//   - the cached prefix is built in the order tools -> system -> messages, so a breakpoint on the system block also
//     covers the tool definitions;
//   - at most 4 breakpoints per request;
//   - a cache hit needs the prefix up to a breakpoint to be identical to one a previous request wrote; on a miss the
//     API walks back up to 20 blocks from each breakpoint looking for an earlier entry. The `cache_control` markers
//     themselves do not have to match, so a breakpoint may move forward from one request to the next;
//   - prefixes shorter than the model's minimum (512-4,096 tokens depending on the model) are simply not cached;
//     that is not an error.
//
// Nova uses at most three breakpoints per request:
//   1. the static system prompt (plus the tools before it);
//   2. the last history message, so the next chat turn reads the whole earlier conversation from cache;
//   3. in the tool loop, the latest message, so each step reads the previous steps from cache.

export const ANTHROPIC_EPHEMERAL_CACHE_CONTROL = Object.freeze({ type: "ephemeral" });

/**
 * The `system` field with one cache breakpoint: a single text block marked `cache_control`.
 * An empty or non-string system is returned unchanged (arrays are assumed to be caller-built blocks).
 */
export function toCachedClaudeSystem(system) {
  if (typeof system !== "string") return system;
  const text = system.trim();
  if (!text) return system;
  return [{ type: "text", text, cache_control: { ...ANTHROPIC_EPHEMERAL_CACHE_CONTROL } }];
}

function toContentBlocks(content) {
  if (Array.isArray(content)) return content.map((block) => (block && typeof block === "object" ? { ...block } : block));
  const text = String(content ?? "");
  return text ? [{ type: "text", text }] : [];
}

/**
 * A copy of `messages` where the message at `index` carries a cache breakpoint on its last content block.
 * String content becomes a single text block. The input array and its messages are never mutated, so the
 * breakpoint does not stick to a message that a later request reuses. An invalid index or an empty message
 * returns the array unchanged.
 */
export function withClaudeCacheBreakpoint(messages, index) {
  if (!Array.isArray(messages) || !Number.isInteger(index) || index < 0 || index >= messages.length) return messages;
  const target = messages[index];
  if (!target || typeof target !== "object") return messages;
  const blocks = toContentBlocks(target.content);
  const lastIndex = blocks.length - 1;
  const last = blocks[lastIndex];
  if (!last || typeof last !== "object") return messages;
  if (last.type === "text" && !String(last.text || "").trim()) return messages;
  blocks[lastIndex] = { ...last, cache_control: { ...ANTHROPIC_EPHEMERAL_CACHE_CONTROL } };
  const next = messages.slice();
  next[index] = { ...target, content: blocks };
  return next;
}

/** Applies withClaudeCacheBreakpoint for each index (duplicates and invalid indexes are ignored). */
export function withClaudeCacheBreakpoints(messages, indexes) {
  let out = messages;
  for (const index of new Set(Array.isArray(indexes) ? indexes : [])) {
    out = withClaudeCacheBreakpoint(out, index);
  }
  return out;
}
