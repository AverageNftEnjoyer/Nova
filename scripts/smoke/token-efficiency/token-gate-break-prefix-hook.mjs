/**
 * Module-loader hook for the token regression gate's self-test (token-regression-gate.mjs). Not a smoke.
 *
 * Loaded with `node --import <this file> token-baseline-harness.mjs ...`. It rewrites the source of
 * src/runtime/modules/context/system-prompt/index.js IN MEMORY while Node loads it (module.registerHooks, same
 * thread); no file on disk is touched. The harness imports the runtime straight from src/ as ES modules, so this is
 * the module that builds the static system prompt for every chat turn and tool loop.
 *
 * NOVA_TOKEN_GATE_MUTATION selects the deliberate regression:
 * - "break-prefix": prefixes the identity line (the first line of the STATIC prompt) with a per-call counter, so the
 *   static block differs on every turn. That is the classic caching bug: per-turn text leaking into the cached
 *   prefix. The gate must fail on its stable-prefix floor.
 * - "bloat-prompt": appends a fixed ~1,250-token block to the static prompt (about +20-25% on a tool-loop call). The
 *   prefix stays stable, but the gate must fail on its size ceilings. (Chat turns grow less: the chat history budget
 *   trims older turns to make room, which is why the ceilings are checked on every scenario, not just chat.)
 * Any other value (or unset) loads the module unchanged.
 */
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const MODE = String(process.env.NOVA_TOKEN_GATE_MUTATION || "").trim();
const TARGET_SUFFIX = "/src/runtime/modules/context/system-prompt/index.js";
const IDENTITY_LINE = "\"You are Nova Operator, the only user-facing assistant identity in the Nova runtime.\",";
export const MUTATION_MARKER = "[token-gate-hook] mutation applied:";

const BLOAT_TEXT = Array.from({ length: 40 }, (_, i) =>
  `Gate bloat rule ${i + 1}: this sentence is deliberate filler that stands in for an oversized static policy block.`,
).join(" ");

function mutate(source) {
  if (!source.includes(IDENTITY_LINE)) {
    throw new Error(`[token-gate-hook] identity line not found in ${TARGET_SUFFIX}; update the hook to the new prompt`);
  }
  if (MODE === "break-prefix") {
    return source.replace(
      IDENTITY_LINE,
      "`[turn ${(globalThis.__novaTokenGateTurn = (globalThis.__novaTokenGateTurn || 0) + 1)}] "
        + "You are Nova Operator, the only user-facing assistant identity in the Nova runtime.`,",
    );
  }
  if (MODE === "bloat-prompt") {
    return source.replace(IDENTITY_LINE, `${IDENTITY_LINE}\n    ${JSON.stringify(BLOAT_TEXT)},`);
  }
  return source;
}

if (MODE === "break-prefix" || MODE === "bloat-prompt") {
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (!url.startsWith("file:")) return result;
      if (!fileURLToPath(url).replaceAll("\\", "/").endsWith(TARGET_SUFFIX)) return result;
      const source = typeof result.source === "string" ? result.source : Buffer.from(result.source).toString("utf8");
      const rewritten = mutate(source);
      // stderr: the harness silences console.log while scenarios run, and the gate looks for this line.
      process.stderr.write(`${MUTATION_MARKER} ${MODE} -> ${TARGET_SUFFIX}\n`);
      return { ...result, source: rewritten };
    },
  });
}
