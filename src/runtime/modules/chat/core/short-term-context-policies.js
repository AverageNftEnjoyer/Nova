const GENERIC_CANCEL_REGEX = /\b(cancel|never\s*mind|nevermind|stop|forget\s+it|ignore\s+that|scratch\s+that)\b/i;
const GENERIC_NEW_TOPIC_REGEX = /\b(new\s+topic|switch\s+topic|different\s+topic|let'?s\s+talk\s+about|talk\s+about\s+something\s+else)\b/i;

const CRYPTO_CONTINUE_REGEX = /\b(again|same|more\s+detail|more|expand|expanded|drill\s+down|break\s*down|oh\s+wait|wait|also|refresh|rerun|repeat)\b/i;
const ASSISTANT_CONTINUE_REGEX = /\b(oh\s+wait|wait|also|and|more\s+detail|expand|go\s+on|continue|that\s+one|same\s+thing|clarify)\b/i;
const MISSION_CONTINUE_REGEX = /\b(also|and|add|change|update|more\s+detail|details|at|am|pm|tomorrow|daily|weekly|weekday|channel|discord|telegram)\b/i;

const CODING_ASSISTANT_REGEX = /\b(code|coding|bug|debug|fix|refactor|test|lint|build|deploy|script|function|class|module|typescript|javascript|python|sql|api|endpoint|runtime|stack\s*trace)\b/i;
const MISSION_TASK_REGEX = /\b(mission|workflow|automation|schedule|scheduled|remind|reminder|task|todo|notification)\b/i;

const POLICIES = {
  crypto: {
    domainId: "crypto",
    ttlMs: Number.parseInt(process.env.NOVA_STC_TTL_CRYPTO_MS || "120000", 10),
    isCancel: (text) => GENERIC_CANCEL_REGEX.test(text),
    isNewTopic: (text) => GENERIC_NEW_TOPIC_REGEX.test(text),
    isNonCriticalFollowUp: (text) => CRYPTO_CONTINUE_REGEX.test(text),
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(price|quote|ticker)\b/.test(normalized)) return "crypto_price";
      if (/\b(transaction|history|activity)\b/.test(normalized)) return "crypto_transactions";
      if (/\b(portfolio|account|balance|holdings)\b/.test(normalized)) return "crypto_portfolio";
      if (/\b(report|summary|pnl|daily|weekly)\b/.test(normalized)) return "crypto_report";
      return String(existing.topicAffinityId || "crypto_general");
    },
  },
  assistant: {
    domainId: "assistant",
    ttlMs: Number.parseInt(process.env.NOVA_STC_TTL_ASSISTANT_MS || "120000", 10),
    isCancel: (text) => GENERIC_CANCEL_REGEX.test(text),
    isNewTopic: (text) => GENERIC_NEW_TOPIC_REGEX.test(text),
    isNonCriticalFollowUp: (text) => ASSISTANT_CONTINUE_REGEX.test(text),
    resolveTopicAffinityId: (text, existing = {}) => {
      if (CODING_ASSISTANT_REGEX.test(String(text || ""))) return "coding_assistant";
      return String(existing.topicAffinityId || "general_assistant");
    },
  },
  mission_task: {
    domainId: "mission_task",
    ttlMs: Number.parseInt(process.env.NOVA_STC_TTL_MISSION_MS || "180000", 10),
    isCancel: (text) => GENERIC_CANCEL_REGEX.test(text),
    isNewTopic: (text) => GENERIC_NEW_TOPIC_REGEX.test(text),
    isNonCriticalFollowUp: (text) => MISSION_CONTINUE_REGEX.test(text),
    resolveTopicAffinityId: (text, existing = {}) => {
      if (MISSION_TASK_REGEX.test(String(text || ""))) return "mission_task";
      return String(existing.topicAffinityId || "mission_task");
    },
  },
};

export function getShortTermContextPolicy(domainIdRaw) {
  const domainId = String(domainIdRaw || "").trim().toLowerCase();
  return POLICIES[domainId] || POLICIES.assistant;
}

export function classifyShortTermContextTurn({ domainId, text }) {
  const policy = getShortTermContextPolicy(domainId);
  const normalized = String(text || "").trim().toLowerCase();
  return {
    isCancel: policy.isCancel(normalized) === true,
    isNewTopic: policy.isNewTopic(normalized) === true,
    isNonCriticalFollowUp: policy.isNonCriticalFollowUp(normalized) === true,
  };
}
