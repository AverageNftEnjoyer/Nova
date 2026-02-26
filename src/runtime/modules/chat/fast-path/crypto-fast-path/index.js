import {
  applyShortTermContextTurnClassification,
  readShortTermContextState,
} from "../../core/short-term-context-engine.js";
import {
  normalizeCoinbaseCommandText,
  resolveEnabledCoinbaseCommandCategories,
} from "../coinbase-command-parser.js";
import { resolveCoinbaseRolloutAccessForFastPath } from "../coinbase-rollout-policy.js";
import {
  COINBASE_CONSENT_AFFIRM_REGEX,
  COINBASE_WHY_REGEX,
  CONTEXTUAL_REPORT_FOLLOWUP_REGEX,
  FOLLOW_UP_DETAIL_REGEX,
  FOLLOW_UP_REMOVE_RECALL_REGEX,
} from "./constants.js";
import {
  buildCryptoConciergeReply,
  buildMissingPriceTargetReply,
  extractPriceSymbol,
  inferCryptoIntent,
  isCryptoRequestText,
  isExplicitCryptoReportRequest,
  shouldDeferCryptoFastPathToMissionBuilder,
} from "./intent.js";
import {
  getCoinbaseFollowUpKey,
  readCoinbaseFollowUpState,
  updateCoinbaseFollowUpState,
  buildFollowUpReplyFromState,
  readCryptoTopicAffinity,
  clearCryptoTopicAffinity,
  updateCryptoTopicAffinity,
  mergeRemovedSections,
} from "./state.js";
import {
  parseCryptoReportPreferenceDirectives,
  upsertCryptoReportPreferences,
  executeCoinbaseTool,
  buildStatusReply,
  buildPriceReply,
  buildPortfolioReply,
  buildTransactionsReply,
  buildReportReply,
  buildReportRepeatPrefix,
} from "./replies.js";

export {
  isCryptoRequestText,
  isExplicitCryptoReportRequest,
};

export async function tryCryptoFastPathReply({
  text,
  runtimeTools,
  availableTools,
  userContextId,
  conversationId,
  workspaceDir,
}) {
  const normalizedUserContextId = String(userContextId || "").trim();
  if (!normalizedUserContextId) {
    return {
      reply: "I couldn't verify crypto data because user context is missing. Retry from your Nova account session.",
      source: "validation",
    };
  }
  const normalizedInput = normalizeCoinbaseCommandText(text);
  if (shouldDeferCryptoFastPathToMissionBuilder(normalizedInput)) {
    return { reply: "", source: "" };
  }

  const followUpKey = getCoinbaseFollowUpKey(normalizedUserContextId, conversationId);
  const followUpState = readCoinbaseFollowUpState(followUpKey);
  const shortTermTurn = applyShortTermContextTurnClassification({
    userContextId: normalizedUserContextId,
    conversationId,
    domainId: "crypto",
    text: normalizedInput,
  });
  const topicAffinity = readCryptoTopicAffinity(normalizedUserContextId, conversationId);
  const topicSlots = topicAffinity?.slots && typeof topicAffinity.slots === "object" ? topicAffinity.slots : {};
  const missionAffinity = readShortTermContextState({
    userContextId: normalizedUserContextId,
    conversationId,
    domainId: "mission_task",
  });
  const assistantAffinity = readShortTermContextState({
    userContextId: normalizedUserContextId,
    conversationId,
    domainId: "assistant",
  });
  const missionContextIsNewer = Number(missionAffinity?.ts || 0) > Number(topicAffinity?.ts || 0);
  const assistantContextIsNewer = Number(assistantAffinity?.ts || 0) > Number(topicAffinity?.ts || 0);
  const sameConversationAffinity =
    topicAffinity && String(topicAffinity.conversationId || "").trim() === String(conversationId || "").trim();
  const contextualCryptoFollowUp = sameConversationAffinity && CONTEXTUAL_REPORT_FOLLOWUP_REGEX.test(normalizedInput);
  const isCryptoRequest = isCryptoRequestText(text) || contextualCryptoFollowUp;

  if (!isCryptoRequest) {
    if (shortTermTurn.isCancel) {
      clearCryptoTopicAffinity(normalizedUserContextId, conversationId);
      return { reply: "Okay, cleared the current crypto follow-up context.", source: "followup" };
    }
    if (shortTermTurn.isNewTopic) {
      clearCryptoTopicAffinity(normalizedUserContextId, conversationId);
      return { reply: "", source: "" };
    }
    if (sameConversationAffinity && FOLLOW_UP_REMOVE_RECALL_REGEX.test(normalizedInput)) {
      const removed = Array.isArray(topicSlots?.removedSections) ? topicSlots.removedSections : [];
      if (removed.length > 0) {
        updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
          topicAffinityId: "crypto_report_followup",
        });
        return {
          reply: `You asked me to remove: ${removed.join(", ")}.`,
          source: "coinbase_followup",
        };
      }
    }
    if (missionContextIsNewer || assistantContextIsNewer) {
      return { reply: "", source: "" };
    }
    if (
      sameConversationAffinity
      && /\b(total|balance|pnl|profit|loss|worth|value|price)\b/i.test(normalizedInput)
      && (
        String(topicSlots?.lastReportReply || "").trim().length > 0
        || /\b(report|portfolio|price|transactions|assist)\b/i.test(String(topicSlots?.intent || ""))
      )
    ) {
      const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_report", {
        userContextId: normalizedUserContextId,
        conversationId: String(conversationId || "").trim(),
        transactionLimit: 8,
        mode: "concise",
      });
      updateCoinbaseFollowUpState(followUpKey, payload);
      const reportReply = buildReportReply(payload, {
        normalizedInput,
        userContextId: normalizedUserContextId,
        workspaceDir,
      });
      updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
        topicAffinityId: "crypto_report_followup",
        intent: "report",
        lastReportMode: "concise",
        lastReportReply: String(reportReply || "").trim(),
      });
      return { reply: reportReply, source: "coinbase_followup", toolCall: "coinbase_portfolio_report" };
    }
    if (sameConversationAffinity && shortTermTurn.isNonCriticalFollowUp && String(topicSlots?.intent || "") === "report") {
      const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_report", {
        userContextId: normalizedUserContextId,
        conversationId: String(conversationId || "").trim(),
        transactionLimit: 8,
        mode: FOLLOW_UP_DETAIL_REGEX.test(normalizedInput) ? "detailed" : String(topicSlots?.lastReportMode || "concise"),
      });
      updateCoinbaseFollowUpState(followUpKey, payload);
      const reportReply = buildReportReply(payload, {
        normalizedInput,
        userContextId: normalizedUserContextId,
        workspaceDir,
      });
      const detailedRequested = FOLLOW_UP_DETAIL_REGEX.test(normalizedInput);
      if (!payload?.ok && detailedRequested && String(topicSlots?.lastReportReply || "").trim()) {
        return {
          reply: `Detailed report refresh is unavailable right now. Last known report:\n${String(topicSlots.lastReportReply).trim()}`,
          source: "coinbase_followup",
          toolCall: "coinbase_portfolio_report",
        };
      }
      updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
        topicAffinityId: "crypto_report_followup",
        intent: "report",
        lastReportMode: FOLLOW_UP_DETAIL_REGEX.test(normalizedInput) ? "detailed" : String(topicSlots?.lastReportMode || "concise"),
        lastReportReply: String(reportReply || "").trim(),
      });
      return { reply: reportReply, source: "coinbase_followup", toolCall: "coinbase_portfolio_report" };
    }
    if (followUpState && (COINBASE_CONSENT_AFFIRM_REGEX.test(normalizedInput) || COINBASE_WHY_REGEX.test(normalizedInput))) {
      return { reply: buildFollowUpReplyFromState(followUpState), source: "coinbase_followup" };
    }
    return { reply: "", source: "" };
  }

  const prefsCommand = parseCryptoReportPreferenceDirectives(text, { assumeReportContext: sameConversationAffinity });
  if (prefsCommand.ok) {
    try {
      const persisted = upsertCryptoReportPreferences({
        userContextId: normalizedUserContextId,
        workspaceDir,
        directives: prefsCommand.directives,
      });
      if (!persisted.ok) {
        return { reply: "I couldn't save your crypto report preferences yet. Retry once.", source: "preference" };
      }
      const applied = persisted.applied.filter((line) => !/^rule:/i.test(String(line || "")));
      const removedSections = mergeRemovedSections(topicSlots?.removedSections, applied);
      updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
        topicAffinityId: "crypto_report_preferences",
        intent: "report",
        lastReportMode: String(topicSlots?.lastReportMode || "concise"),
        lastPreferenceDirectives: applied.slice(-12),
        removedSections,
      });
      return {
        reply: [
          "Saved your crypto report preferences for this user profile.",
          applied.length > 0 ? `Applied: ${applied.join(" | ")}` : "Applied: custom rule stored.",
          "Future crypto reports will use these defaults unless you change them.",
        ].join("\n"),
        source: "preference",
      };
    } catch {
      return { reply: "I couldn't save your crypto report preferences yet. Retry once.", source: "preference" };
    }
  }

  if (sameConversationAffinity && FOLLOW_UP_REMOVE_RECALL_REGEX.test(normalizedInput)) {
    const removed = Array.isArray(topicSlots?.removedSections) ? topicSlots.removedSections : [];
    if (removed.length > 0) {
      updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
        topicAffinityId: "crypto_report_followup",
      });
      return {
        reply: `You asked me to remove: ${removed.join(", ")}.`,
        source: "coinbase_followup",
      };
    }
  }
  if (
    sameConversationAffinity
    && FOLLOW_UP_DETAIL_REGEX.test(normalizedInput)
    && /\b(report|portfolio|assist)\b/i.test(String(topicSlots?.intent || ""))
  ) {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_report", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
      transactionLimit: 8,
      mode: "detailed",
    });
    updateCoinbaseFollowUpState(followUpKey, payload);
    let reportReply = buildReportReply(payload, {
      normalizedInput,
      userContextId: normalizedUserContextId,
      workspaceDir,
    });
    if (!payload?.ok && String(topicSlots?.lastReportReply || "").trim()) {
      reportReply = `Detailed report refresh is unavailable right now. Last known report:\n${String(topicSlots.lastReportReply).trim()}`;
    }
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_report_followup",
      intent: "report",
      lastReportMode: "detailed",
      lastReportReply: String(reportReply || "").trim(),
    });
    return { reply: reportReply, source: "coinbase_followup", toolCall: "coinbase_portfolio_report" };
  }

  const intent = inferCryptoIntent(text);
  const forceReportByContext =
    sameConversationAffinity
    && /\b(report|summary|pnl|concise|detailed|detail|freshness|timestamp|format|again|rerun|refresh)\b/i.test(normalizedInput);
  const shouldPromoteToReport =
    sameConversationAffinity
    && /\b(total|balance|worth|value|portfolio|account)\b/i.test(normalizedInput)
    && /\b(price|it|that|this)\b/i.test(normalizedInput)
    && /\b(assist|report|portfolio)\b/i.test(String(topicSlots?.intent || ""));
  const effectiveIntent = (shouldPromoteToReport || forceReportByContext) ? "report" : intent;

  if (effectiveIntent === "assist") {
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_assist",
      intent: "assist",
    });
    return {
      reply: buildCryptoConciergeReply(),
      source: "coinbase",
    };
  }
  if (shortTermTurn.isCancel) {
    clearCryptoTopicAffinity(normalizedUserContextId, conversationId);
    return { reply: "Okay, cleared the current crypto follow-up context.", source: "followup" };
  }
  if (/\b(buy|sell|trade|swap|transfer|withdraw|deposit)\b/i.test(normalizedInput)) {
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_policy",
      intent: "policy",
    });
    return {
      reply: "Coinbase trade/transfer execution is out of scope in Nova v1. I can help with read-only prices, portfolio, transactions, and reports.",
      source: "policy",
    };
  }
  if (/\bweekly\s+report\b/i.test(normalizedInput) && !/\b(pnl|portfolio|crypto)\b/i.test(normalizedInput)) {
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_report_clarify",
      intent: "report",
    });
    return {
      reply: "Do you want a weekly portfolio report or weekly PnL report?",
      source: "clarify",
    };
  }

  const category = effectiveIntent === "report" ? "reports" : effectiveIntent;
  const rollout = resolveCoinbaseRolloutAccessForFastPath(normalizedUserContextId);
  if (!rollout.enabled) {
    return {
      reply: `Coinbase is not enabled for this user cohort yet (stage=${rollout.stage}, reason=${rollout.reason}). Support: ${rollout.supportChannel}.`,
      source: "policy",
    };
  }

  const enabledCategories = resolveEnabledCoinbaseCommandCategories();
  if (!enabledCategories.has(category)) {
    return {
      reply: `Coinbase ${category} commands are currently disabled by admin policy. Ask an admin to enable category "${category}" via NOVA_COINBASE_COMMAND_CATEGORIES.`,
      source: "policy",
    };
  }

  if (effectiveIntent === "status") {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_capabilities", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
    });
    updateCoinbaseFollowUpState(followUpKey, payload);
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_status",
      intent: "status",
    });
    return { reply: buildStatusReply(payload), source: "coinbase", toolCall: "coinbase_capabilities" };
  }

  if (effectiveIntent === "price") {
    if (/\b(price\s+usd|usd\s+price)\b/i.test(normalizedInput)) {
      return {
        reply: "USD is the quote currency, not the crypto asset target. Share the crypto ticker (for example BTC or ETH).",
        source: "validation",
      };
    }
    const symbolResolution = extractPriceSymbol(text);
    if (symbolResolution.status === "ambiguous" && symbolResolution.suggestion) {
      return {
        reply: `I am not fully confident on the ticker. Did you mean ${symbolResolution.suggestion}? Send that symbol/pair exactly and I will fetch it.`,
        source: "clarify",
      };
    }
    if (symbolResolution.status !== "resolved" || !symbolResolution.symbolPair) {
      return {
        reply: buildMissingPriceTargetReply(),
        source: "validation",
      };
    }
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_spot_price", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
      symbolPair: symbolResolution.symbolPair,
    });
    updateCoinbaseFollowUpState(followUpKey, payload);
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_price",
      intent: "price",
      lastSymbolPair: symbolResolution.symbolPair,
    });
    return { reply: buildPriceReply(payload), source: "coinbase", toolCall: "coinbase_spot_price" };
  }

  if (effectiveIntent === "portfolio") {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_snapshot", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
    });
    updateCoinbaseFollowUpState(followUpKey, payload);
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_portfolio",
      intent: "portfolio",
    });
    return { reply: buildPortfolioReply(payload), source: "coinbase", toolCall: "coinbase_portfolio_snapshot" };
  }

  if (effectiveIntent === "transactions") {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_recent_transactions", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
      limit: 6,
    });
    updateCoinbaseFollowUpState(followUpKey, payload);
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_transactions",
      intent: "transactions",
    });
    return { reply: buildTransactionsReply(payload), source: "coinbase", toolCall: "coinbase_recent_transactions" };
  }

  const reportMode = /\b(detailed|full|expanded)\b/i.test(normalizedInput) ? "detailed" : "concise";
  const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_report", {
    userContextId: normalizedUserContextId,
    conversationId: String(conversationId || "").trim(),
    transactionLimit: 8,
    mode: reportMode,
  });
  updateCoinbaseFollowUpState(followUpKey, payload);
  let reportReply = buildReportReply(payload, {
    normalizedInput,
    userContextId: normalizedUserContextId,
    workspaceDir,
  });
  if (!payload?.ok && String(topicSlots?.lastReportReply || "").trim()) {
    reportReply = [
      "Live refresh is unavailable right now. Showing your last known report:",
      String(topicSlots.lastReportReply).trim(),
    ].join("\n");
  }
  const repeatPrefix = buildReportRepeatPrefix(text);
  if (repeatPrefix && String(reportReply || "").trim()) {
    reportReply = `${repeatPrefix}${String(reportReply || "").trim()}`;
  }
  updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
    topicAffinityId: "crypto_report",
    intent: "report",
    lastReportMode: reportMode,
    lastReportReply: String(reportReply || "").trim(),
  });
  return { reply: reportReply, source: "coinbase", toolCall: "coinbase_portfolio_report" };
}
