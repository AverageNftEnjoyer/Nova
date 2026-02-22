function parseBoundedInt(rawValue, fallback, min, max) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const FAST_LANE_MAX_CHARS = parseBoundedInt(process.env.NOVA_FAST_LANE_MAX_CHARS, 42, 12, 220);
const FAST_LANE_MAX_WORDS = parseBoundedInt(process.env.NOVA_FAST_LANE_MAX_WORDS, 8, 2, 24);
const MEMORY_RECALL_MIN_CHARS = parseBoundedInt(process.env.NOVA_MEMORY_RECALL_MIN_CHARS, 18, 8, 240);
const MEMORY_RECALL_MIN_WORDS = parseBoundedInt(process.env.NOVA_MEMORY_RECALL_MIN_WORDS, 6, 2, 40);

const FAST_LANE_ALLOWED_PHRASES = new Set([
  "hey",
  "hi",
  "hello",
  "yo",
  "sup",
  "ping",
  "test",
  "ok",
  "okay",
  "thanks",
  "thank you",
  "good morning",
  "good afternoon",
  "good evening",
  "how are you",
  "you there",
]);

const FAST_LANE_BLOCKED_KEYWORDS = /\b(weather|forecast|temperature|rain|snow|mission|workflow|automation|schedule|spotify|shutdown|search|news|crypto|coinbase|bitcoin|ethereum|price|portfolio|transaction|trades)\b/;
const FAST_LANE_BLOCKED_ACTIONS = /\b(remind|create|build|deploy|send|email|discord|telegram)\b/;
const TOOL_LOOP_WEB_INTENT = /\b(search|lookup|look up|browse|web|latest|news|price|scores?)\b/;
const TOOL_LOOP_NEGATED_WEB_INTENT = /\b(do\s+not|don't|dont|without|no)\s+(browse|search|lookup|look up|web|internet)\b/;
const TOOL_LOOP_COMMAND_INTENT = /\b(run|execute|terminal|shell|command|script|npm|node|python|git|build)\b/;
const TOOL_LOOP_REPO_INTENT = /\b(file|folder|directory|read|write|edit|patch|code|refactor|repository|repo)\b/;
const TOOL_LOOP_TOOL_INTENT = /\b(tool|tool call|web fetch|web search|memory search|memory get)\b/;
const MEMORY_RECALL_INTENT = /\b(remember|earlier|before|preference|profile|context|resume|continue|project|my)\b/;

export function normalizeLatencyTurnText(text) {
  return String(text || "")
    .replace(/^\s*(hey|hi|yo)\s+nova[\s,:-]*/i, "")
    .replace(/^\s*nova[\s,:-]*/i, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSimpleFastLaneTurn(text) {
  const normalized = normalizeLatencyTurnText(text);
  if (!normalized) return false;
  if (normalized.length > FAST_LANE_MAX_CHARS) return false;
  const wordCount = normalized.split(/\s+/g).filter(Boolean).length;
  if (wordCount > FAST_LANE_MAX_WORDS) return false;
  if (FAST_LANE_BLOCKED_KEYWORDS.test(normalized)) return false;
  if (FAST_LANE_BLOCKED_ACTIONS.test(normalized)) return false;
  return FAST_LANE_ALLOWED_PHRASES.has(normalized);
}

export function shouldUseToolLoopForTurn(text, opts = {}) {
  const normalized = normalizeLatencyTurnText(text);
  if (!normalized) return false;
  if (opts.fastLaneSimpleChat === true) return false;
  if (opts.weatherIntent === true) return false;
  if (opts.cryptoIntent === true) return false;
  if (TOOL_LOOP_NEGATED_WEB_INTENT.test(normalized)) return false;

  const canRunWebSearch = opts.canRunWebSearch === true;
  const canRunWebFetch = opts.canRunWebFetch === true;
  if (canRunWebFetch && /https?:\/\/\S+/i.test(String(text || ""))) return true;
  if (canRunWebSearch && TOOL_LOOP_WEB_INTENT.test(normalized)) return true;
  if (TOOL_LOOP_COMMAND_INTENT.test(normalized)) return true;
  if (TOOL_LOOP_REPO_INTENT.test(normalized)) return true;
  if (TOOL_LOOP_TOOL_INTENT.test(normalized)) return true;
  return false;
}

export function shouldAttemptMemoryRecallTurn(text, opts = {}) {
  const normalized = normalizeLatencyTurnText(text);
  if (!normalized) return false;
  if (normalized.length < MEMORY_RECALL_MIN_CHARS) return false;
  if (opts.fastLaneSimpleChat === true) return false;
  if (opts.weatherIntent === true) return false;
  if (opts.cryptoIntent === true) return false;
  const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
  if (tokenCount >= MEMORY_RECALL_MIN_WORDS) return true;
  return MEMORY_RECALL_INTENT.test(normalized);
}

export function buildLatencyTurnPolicy(text, opts = {}) {
  const weatherIntent = opts.weatherIntent === true;
  const cryptoIntent = opts.cryptoIntent === true;
  const canRunWebSearchHint = opts.canRunWebSearchHint !== false;
  const canRunWebFetchHint = opts.canRunWebFetchHint !== false;
  const fastLaneSimpleChat = isSimpleFastLaneTurn(text);
  const toolLoopCandidate = shouldUseToolLoopForTurn(text, {
    fastLaneSimpleChat,
    weatherIntent,
    cryptoIntent,
    canRunWebSearch: canRunWebSearchHint,
    canRunWebFetch: canRunWebFetchHint,
  });
  const memoryRecallCandidate = shouldAttemptMemoryRecallTurn(text, {
    fastLaneSimpleChat,
    weatherIntent,
    cryptoIntent,
  });
  const likelyNeedsToolRuntime = weatherIntent || cryptoIntent || toolLoopCandidate;
  return {
    fastLaneSimpleChat,
    weatherIntent,
    cryptoIntent,
    toolLoopCandidate,
    memoryRecallCandidate,
    canRunWebSearchHint,
    canRunWebFetchHint,
    shouldSkipRuntimeSkillsPrompt: fastLaneSimpleChat,
    likelyNeedsToolRuntime,
  };
}

export function resolveToolExecutionPolicy(turnPolicy, opts = {}) {
  const availableTools = Array.isArray(opts.availableTools) ? opts.availableTools : [];
  const toolLoopEnabled = opts.toolLoopEnabled === true;
  const canExecuteTools =
    toolLoopEnabled &&
    availableTools.length > 0 &&
    typeof opts.executeToolUse === "function";
  const canRunWebSearch =
    canExecuteTools &&
    availableTools.some((tool) => String(tool?.name || "") === "web_search");
  const canRunWebFetch =
    canExecuteTools &&
    availableTools.some((tool) => String(tool?.name || "") === "web_fetch");
  const canRunToolLoop =
    canExecuteTools &&
    shouldUseToolLoopForTurn(opts.text || "", {
      fastLaneSimpleChat: turnPolicy?.fastLaneSimpleChat === true,
      weatherIntent: turnPolicy?.weatherIntent === true,
      cryptoIntent: turnPolicy?.cryptoIntent === true,
      canRunWebSearch,
      canRunWebFetch,
    });

  return {
    canExecuteTools,
    canRunToolLoop,
    canRunWebSearch,
    canRunWebFetch,
    shouldPreloadWebSearch:
      turnPolicy?.fastLaneSimpleChat !== true &&
      turnPolicy?.canRunWebSearchHint === true &&
      canRunWebSearch,
    shouldPreloadWebFetch:
      turnPolicy?.fastLaneSimpleChat !== true &&
      turnPolicy?.canRunWebFetchHint === true &&
      canRunWebFetch,
    shouldAttemptMemoryRecall:
      turnPolicy?.fastLaneSimpleChat !== true &&
      turnPolicy?.memoryRecallCandidate === true,
  };
}
