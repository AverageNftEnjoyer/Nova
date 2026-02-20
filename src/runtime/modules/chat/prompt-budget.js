import { countApproxTokens } from "../../core/context-prompt.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

export function appendBudgetedPromptSection({
  prompt,
  sectionTitle,
  sectionBody,
  userMessage,
  maxPromptTokens,
  responseReserveTokens,
  historyTargetTokens,
  sectionMaxTokens,
  debug = false,
}) {
  const basePrompt = String(prompt || "");
  const title = normalizeText(sectionTitle) || "Context";
  const body = normalizeText(sectionBody);
  if (!body) {
    return { prompt: basePrompt, included: false, compacted: false, reason: "empty_body" };
  }

  const inputBudget = computeInputPromptBudget(maxPromptTokens, responseReserveTokens);
  const userTokens = countApproxTokens(userMessage || "");
  const desiredHistoryTokens = Number.isFinite(historyTargetTokens) ? Math.max(0, Math.floor(historyTargetTokens)) : 0;
  const maxSystemTokens = Math.max(240, inputBudget - userTokens - desiredHistoryTokens);
  const currentSystemTokens = countApproxTokens(basePrompt);
  const availableSystemTokens = maxSystemTokens - currentSystemTokens;
  if (availableSystemTokens <= 28) {
    if (debug) {
      console.log(
        `[PromptBudget] skip section="${title}" reason=no_system_budget available=${availableSystemTokens} max_system=${maxSystemTokens}`,
      );
    }
    return { prompt: basePrompt, included: false, compacted: false, reason: "no_system_budget" };
  }

  const sectionHeader = `\n\n## ${title}\n`;
  const headerTokens = countApproxTokens(sectionHeader);
  const maxSection = Number.isFinite(sectionMaxTokens) ? Math.max(48, Math.floor(sectionMaxTokens)) : 320;
  const sectionBudget = Math.max(0, Math.min(availableSystemTokens, maxSection));
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
  let nextTokens = countApproxTokens(nextPrompt);
  if (nextTokens > maxSystemTokens) {
    const overflow = nextTokens - maxSystemTokens;
    bodyForPrompt = compactTextToTokenBudget(body, Math.max(20, bodyBudgetTokens - overflow - 8), 120);
    if (!bodyForPrompt) {
      return { prompt: basePrompt, included: false, compacted: false, reason: "overflow_after_compaction" };
    }
    nextPrompt = `${basePrompt}${sectionHeader}${bodyForPrompt}`;
    nextTokens = countApproxTokens(nextPrompt);
  }

  if (nextTokens > maxSystemTokens) {
    if (debug) {
      console.log(
        `[PromptBudget] skip section="${title}" reason=overflow max_system=${maxSystemTokens} next=${nextTokens}`,
      );
    }
    return { prompt: basePrompt, included: false, compacted: false, reason: "overflow" };
  }

  const compacted = normalizeText(bodyForPrompt).length < body.length;
  if (debug) {
    console.log(
      `[PromptBudget] include section="${title}" compacted=${compacted ? "1" : "0"} section_tokens=${countApproxTokens(bodyForPrompt)} available=${availableSystemTokens}`,
    );
  }
  return {
    prompt: nextPrompt,
    included: true,
    compacted,
    reason: compacted ? "compacted" : "full",
    sectionTokens: countApproxTokens(bodyForPrompt),
    availableSystemTokens,
    maxSystemTokens,
  };
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
