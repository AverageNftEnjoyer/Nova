import { countApproxTokens } from "../../../../core/context-prompt/index.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parsePositiveInt(rawValue, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (min <= 0 && parsed === 0) return 0;
  if (parsed <= 0) return fallback;
  return clamp(parsed, min, max);
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function truncateAtWordBoundary(text, maxChars) {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  const slice = normalized.slice(0, Math.max(1, maxChars + 1));
  const cut = Math.max(
    slice.lastIndexOf("\n"),
    slice.lastIndexOf(". "),
    slice.lastIndexOf("; "),
    slice.lastIndexOf(", "),
    slice.lastIndexOf(" "),
  );
  const index = cut >= Math.floor(maxChars * 0.6) ? cut : maxChars;
  return `${slice.slice(0, index).trim()}...`;
}

export function compactTextToTokenBudget(value, maxTokens, minChars = 96) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const budget = Number.isFinite(maxTokens) ? Math.max(0, Math.floor(maxTokens)) : 0;
  if (budget <= 0) return "";
  if (countApproxTokens(normalized) <= budget) return normalized;

  let maxChars = clamp(Math.floor(budget * 3.4), minChars, normalized.length);
  let compacted = truncateAtWordBoundary(normalized, maxChars);
  let guard = 0;
  while (compacted && countApproxTokens(compacted) > budget && maxChars > minChars && guard < 8) {
    maxChars = clamp(Math.floor(maxChars * 0.82), minChars, normalized.length);
    compacted = truncateAtWordBoundary(normalized, maxChars);
    guard += 1;
  }
  return compacted;
}

export function computeInputPromptBudget(maxPromptTokens, responseReserveTokens) {
  const maxPrompt = Number.isFinite(maxPromptTokens) ? Math.max(1, Math.floor(maxPromptTokens)) : 1;
  const reserve = Number.isFinite(responseReserveTokens) ? Math.max(0, Math.floor(responseReserveTokens)) : 0;
  return Math.max(480, maxPrompt - reserve);
}

export function resolveDynamicPromptBudget({
  maxPromptTokens,
  responseReserveTokens,
  historyTargetTokens,
  sectionMaxTokens,
  fastLaneSimpleChat = false,
  strictOutputConstraints = false,
}) {
  const resolved = {
    maxPromptTokens: parsePositiveInt(maxPromptTokens, 6000, 512, 64000),
    responseReserveTokens: parsePositiveInt(responseReserveTokens, 1400, 128, 12000),
    historyTargetTokens: parsePositiveInt(historyTargetTokens, 1400, 0, 24000),
    sectionMaxTokens: parsePositiveInt(sectionMaxTokens, 1000, 48, 12000),
    profile: "default",
  };

  if (strictOutputConstraints === true) {
    resolved.profile = "constraints";
    return resolved;
  }

  if (fastLaneSimpleChat === true) {
    const fastLaneHistoryTarget = parsePositiveInt(
      process.env.NOVA_FAST_LANE_HISTORY_TARGET_TOKENS,
      320,
      64,
      1600,
    );
    const fastLaneSectionMax = parsePositiveInt(
      process.env.NOVA_FAST_LANE_SECTION_MAX_TOKENS,
      240,
      48,
      1600,
    );
    const fastLaneResponseReserve = parsePositiveInt(
      process.env.NOVA_FAST_LANE_RESPONSE_RESERVE_TOKENS,
      900,
      128,
      4000,
    );
    resolved.historyTargetTokens = Math.min(resolved.historyTargetTokens, fastLaneHistoryTarget);
    resolved.sectionMaxTokens = Math.min(resolved.sectionMaxTokens, fastLaneSectionMax);
    resolved.responseReserveTokens = Math.min(resolved.responseReserveTokens, fastLaneResponseReserve);
    resolved.profile = "fast_lane";
  }

  return resolved;
}

/**
 * Appends one "## <title>" section to `prompt`, compacted to fit a token budget. Two budget modes:
 *
 * - Per-turn context mode (`turnContextMaxTokens` and `turnContextStart` given): the budget covers only the text
 *   of `prompt` from char index `turnContextStart` on (the part appended after the static system prompt), so the
 *   size of the static persona never starves a section. `reservedTokens` keeps that many tokens of the per-turn
 *   budget free for higher-priority sections that are still to come. Rejection reason: "no_turn_context_budget".
 * - Legacy mode (those params absent): the whole prompt must fit the system share of the input budget
 *   (maxPromptTokens - responseReserveTokens - user message - historyTargetTokens). Rejection: "no_system_budget".
 *
 * In both modes the section itself is capped at `sectionMaxTokens` (header included).
 */
export function appendBudgetedPromptSection({
  prompt,
  sectionTitle,
  sectionBody,
  userMessage,
  maxPromptTokens,
  responseReserveTokens,
  historyTargetTokens,
  sectionMaxTokens,
  turnContextStart,
  turnContextMaxTokens,
  reservedTokens = 0,
  debug = false,
}) {
  const basePrompt = String(prompt || "");
  const title = normalizeText(sectionTitle) || "Context";
  const body = normalizeText(sectionBody);
  if (!body) {
    return { prompt: basePrompt, included: false, compacted: false, reason: "empty_body" };
  }

  const turnMode = Number.isFinite(turnContextMaxTokens) && turnContextMaxTokens > 0
    && Number.isFinite(turnContextStart) && turnContextStart >= 0;
  const turnStart = turnMode ? Math.min(basePrompt.length, Math.floor(turnContextStart)) : 0;
  const reserve = Number.isFinite(reservedTokens) ? Math.max(0, Math.floor(reservedTokens)) : 0;
  // measure(): the tokens that count against the budget; maxTokens: the budget.
  const measure = turnMode
    ? (text) => countApproxTokens(text.slice(turnStart))
    : (text) => countApproxTokens(text);
  let maxTokens;
  if (turnMode) {
    maxTokens = Math.max(0, Math.floor(turnContextMaxTokens) - reserve);
  } else {
    const inputBudget = computeInputPromptBudget(maxPromptTokens, responseReserveTokens);
    const userTokens = countApproxTokens(userMessage || "");
    const desiredHistoryTokens = Number.isFinite(historyTargetTokens) ? Math.max(0, Math.floor(historyTargetTokens)) : 0;
    maxTokens = Math.max(240, inputBudget - userTokens - desiredHistoryTokens);
  }
  const noBudgetReason = turnMode ? "no_turn_context_budget" : "no_system_budget";
  const available = maxTokens - measure(basePrompt);
  if (available <= 28) {
    if (debug) {
      console.log(
        `[PromptBudget] skip section="${title}" reason=${noBudgetReason} available=${available} max=${maxTokens} reserved=${reserve}`,
      );
    }
    return { prompt: basePrompt, included: false, compacted: false, reason: noBudgetReason };
  }

  const sectionHeader = `\n\n## ${title}\n`;
  const headerTokens = countApproxTokens(sectionHeader);
  const maxSection = Number.isFinite(sectionMaxTokens) ? Math.max(48, Math.floor(sectionMaxTokens)) : 320;
  const sectionBudget = Math.max(0, Math.min(available, maxSection));
  const bodyBudgetTokens = Math.max(0, sectionBudget - headerTokens);
  if (bodyBudgetTokens <= 18) {
    if (debug) {
      console.log(`[PromptBudget] skip section="${title}" reason=header_exhausted section_budget=${sectionBudget}`);
    }
    return { prompt: basePrompt, included: false, compacted: false, reason: "header_exhausted" };
  }

  let bodyForPrompt = compactTextToTokenBudget(body, bodyBudgetTokens, 120);
  if (!bodyForPrompt) {
    return { prompt: basePrompt, included: false, compacted: false, reason: "empty_after_compaction" };
  }
  let nextPrompt = `${basePrompt}${sectionHeader}${bodyForPrompt}`;
  let nextTokens = measure(nextPrompt);
  if (nextTokens > maxTokens) {
    const overflow = nextTokens - maxTokens;
    bodyForPrompt = compactTextToTokenBudget(body, Math.max(20, bodyBudgetTokens - overflow - 8), 120);
    if (!bodyForPrompt) {
      return { prompt: basePrompt, included: false, compacted: false, reason: "overflow_after_compaction" };
    }
    nextPrompt = `${basePrompt}${sectionHeader}${bodyForPrompt}`;
    nextTokens = measure(nextPrompt);
  }

  if (nextTokens > maxTokens) {
    if (debug) {
      console.log(`[PromptBudget] skip section="${title}" reason=overflow max=${maxTokens} next=${nextTokens}`);
    }
    return { prompt: basePrompt, included: false, compacted: false, reason: "overflow" };
  }

  const compacted = normalizeText(bodyForPrompt).length < body.length;
  if (debug) {
    console.log(
      `[PromptBudget] include section="${title}" compacted=${compacted ? "1" : "0"} section_tokens=${countApproxTokens(bodyForPrompt)} available=${available} mode=${turnMode ? "turn_context" : "system"}`,
    );
  }
  const result = {
    prompt: nextPrompt,
    included: true,
    compacted,
    reason: compacted ? "compacted" : "full",
    sectionTokens: countApproxTokens(bodyForPrompt),
    budgetMode: turnMode ? "turn_context" : "system",
  };
  if (turnMode) {
    result.availableTurnContextTokens = available;
    result.maxTurnContextTokens = maxTokens;
    result.turnContextTokens = nextTokens;
  } else {
    result.availableSystemTokens = available;
    result.maxSystemTokens = maxTokens;
  }
  return result;
}

export function computeHistoryTokenBudget({
  maxPromptTokens,
  responseReserveTokens,
  userMessage,
  systemPrompt,
  maxHistoryTokens,
  minHistoryTokens = 0,
  targetHistoryTokens = 0,
}) {
  const inputBudget = computeInputPromptBudget(maxPromptTokens, responseReserveTokens);
  const systemTokens = countApproxTokens(systemPrompt || "");
  const userTokens = countApproxTokens(userMessage || "");
  const available = Math.max(0, inputBudget - systemTokens - userTokens);

  const maxHistory = Number.isFinite(maxHistoryTokens) ? Math.max(0, Math.floor(maxHistoryTokens)) : 0;
  const minHistory = Number.isFinite(minHistoryTokens) ? Math.max(0, Math.floor(minHistoryTokens)) : 0;
  const target = Number.isFinite(targetHistoryTokens) ? Math.max(minHistory, Math.floor(targetHistoryTokens)) : minHistory;
  if (available <= minHistory) return Math.min(maxHistory, available);
  return Math.min(maxHistory, Math.max(minHistory, Math.min(target, available)));
}
