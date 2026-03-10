import { OPERATOR_LANE_SEQUENCE } from "../chat-handler/operator-lane-config/index.js";

const GENERIC_CANCEL_REGEX = /\b(cancel|never\s*mind|nevermind|stop|forget\s+it|ignore\s+that|scratch\s+that)\b/i;
const GENERIC_NEW_TOPIC_REGEX = /\b(new\s+topic|switch\s+topic|different\s+topic|let'?s\s+talk\s+about|talk\s+about\s+something\s+else)\b/i;

const CRYPTO_CONTINUE_REGEX = /\b(again|same|more\s+detail|more|expand|expanded|drill\s+down|break\s*down|oh\s+wait|wait|also|refresh|rerun|repeat)\b/i;
const ASSISTANT_CONTINUE_REGEX = /\b(oh\s+wait|wait|also|and|more\s+detail|expand|go\s+on|continue|that\s+one|same\s+thing|clarify|at\s+the\s+start|earlier|before|what\s+did\s+i\s+(say|tell\s+you|share|ask)|what\s+.*\b(?:earlier|before|at\s+the\s+start)\b)\b/i;
const MISSION_CONTINUE_REGEX = /\b(also|and|add|change|update|more\s+detail|details|at|am|pm|tomorrow|daily|weekly|weekday|channel|discord|telegram)\b/i;
const SPOTIFY_CONTINUE_REGEX = /\b(what(?:'s| is)\s+(?:this|that|it)\s+(?:song|track)|what\s+(?:song|track)\s+(?:is\s+)?(?:this|that|it)|what\s+am\s+i\s+listening\s+to|currently\s+playing|playing\s+currently|that\s+(?:song|track)|this\s+(?:song|track)|the\s+song\s+playing|you(?:'| a)?re\s+the\s+one\s+playing\s+it|your\s+the\s+one\s+playing\s+it|playing\s+it)\b/i;
const YOUTUBE_CONTINUE_REGEX = /\b(next|another|different|more)\s+(video|clip|broadcast|news)\b|\bmore\s+(on|about)\b/i;
const POLYMARKET_CONTINUE_REGEX = /\b(next|another|different|more)\s+(market|contract|odds)\b|\bmore\s+(odds|markets|contracts)\b/i;
const COINBASE_CONTINUE_REGEX = /\b(refresh|update|again|latest|more\s+detail|portfolio|balances?|wallet|pnl|holdings)\b/i;
const GMAIL_CONTINUE_REGEX = /\b(reply|respond|draft|send\s+it|latest|new|unread|inbox|more\s+detail)\b/i;
const TELEGRAM_CONTINUE_REGEX = /\b(send|post|deliver|retry|status|connected|connection|more\s+detail)\b/i;
const DISCORD_CONTINUE_REGEX = /\b(send|post|deliver|retry|status|connected|connection|more\s+detail)\b/i;
const CALENDAR_CONTINUE_REGEX = /\b(reschedule|move|change|shift|today|tomorrow|this week|next week|availability|more\s+detail)\b/i;
const REMINDER_CONTINUE_REGEX = /\b(when|at|on|tomorrow|today|tonight|update|change|edit|remove|cancel|more\s+detail)\b/i;
const WEB_RESEARCH_CONTINUE_REGEX = /\b(more\s+sources|add\s+citations?|dig\s+deeper|refresh\s+search|latest\s+update)\b/i;
const MARKET_CONTINUE_REGEX = /\b(refresh|update|again|latest|more\s+detail|market|stocks?|indices?|weather|trend)\b/i;
const IMAGE_CONTINUE_REGEX = /\b(another|more|different|variation|edit|tweak|change|upscale|enhance|crop|describe|analyze|inspect|image|photo|picture)\b/i;
const FILES_CONTINUE_REGEX = /\b(open|read|show|list|search|next\s+file|more\s+detail)\b/i;
const MEMORY_CONTINUE_REGEX = /\b(remember|save|store|update|that memory|this memory|more\s+detail)\b/i;
const SHUTDOWN_CONTINUE_REGEX = /\b(confirm|yes|do it|cancel|stop|nevermind)\b/i;
const DIAGNOSTICS_CONTINUE_REGEX = /\b(refresh|rerun|again|latest|more\s+detail|error|latency|trace)\b/i;
const VOICE_CONTINUE_REGEX = /\b(mute|unmute|mic|microphone|voice|more\s+detail)\b/i;
const TTS_CONTINUE_REGEX = /\b(read|speak|voice|tts|more\s+detail)\b/i;

const CODING_ASSISTANT_REGEX = /\b(code|coding|bug|debug|fix|refactor|test|lint|build|deploy|script|function|class|module|typescript|javascript|python|sql|api|endpoint|runtime|stack\s*trace)\b/i;
const MISSION_TASK_REGEX = /\b(mission|workflow|automation|schedule|scheduled|remind|reminder|task|todo|notification)\b/i;

function createPolicy({
  domainId,
  ttlEnvKey,
  ttlDefaultMs,
  continueRegex,
  resolveTopicAffinityId,
}) {
  return {
    domainId,
    ttlMs: Number.parseInt(process.env[ttlEnvKey] || String(ttlDefaultMs), 10),
    isCancel: (text) => GENERIC_CANCEL_REGEX.test(text),
    isNewTopic: (text) => GENERIC_NEW_TOPIC_REGEX.test(text),
    isNonCriticalFollowUp: (text) => continueRegex.test(text),
    resolveTopicAffinityId,
  };
}

const CORE_POLICIES = {
  assistant: createPolicy({
    domainId: "assistant",
    ttlEnvKey: "NOVA_STC_TTL_ASSISTANT_MS",
    ttlDefaultMs: 120000,
    continueRegex: ASSISTANT_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      if (CODING_ASSISTANT_REGEX.test(String(text || ""))) return "coding_assistant";
      return String(existing.topicAffinityId || "general_assistant");
    },
  }),
  mission_task: createPolicy({
    domainId: "mission_task",
    ttlEnvKey: "NOVA_STC_TTL_MISSION_MS",
    ttlDefaultMs: 180000,
    continueRegex: MISSION_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      if (MISSION_TASK_REGEX.test(String(text || ""))) return "mission_task";
      return String(existing.topicAffinityId || "mission_task");
    },
  }),
};

const LANE_POLICY_DEFINITIONS = {
  spotify: {
    ttlEnvKey: "NOVA_STC_TTL_SPOTIFY_MS",
    ttlDefaultMs: 180000,
    continueRegex: SPOTIFY_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(now playing|what.*playing|what am i listening|song|track)\b/.test(normalized)) return "spotify_now_playing";
      if (/\b(pause|resume|next|previous|skip|restart|shuffle|repeat|queue|like|unlike|volume)\b/.test(normalized)) {
        return "spotify_playback_control";
      }
      return String(existing.topicAffinityId || "spotify_general");
    },
  },
  youtube: {
    ttlEnvKey: "NOVA_STC_TTL_YOUTUBE_MS",
    ttlDefaultMs: 180000,
    continueRegex: YOUTUBE_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(next|another|different)\s+(video|clip|news|broadcast)\b/.test(normalized)) return "youtube_next_video";
      if (/\b(show|find|get|pull)\s+(me\s+)?(news|video|videos|broadcast|broadcasts)\s+(about|on|for)\b/.test(normalized)) {
        return "youtube_topic_lookup";
      }
      return String(existing.topicAffinityId || "youtube_general");
    },
  },
  polymarket: {
    ttlEnvKey: "NOVA_STC_TTL_POLYMARKET_MS",
    ttlDefaultMs: 180000,
    continueRegex: POLYMARKET_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(election|president|senate|house|vote)\b/.test(normalized)) return "polymarket_politics";
      if (/\b(btc|bitcoin|eth|ethereum|crypto)\b/.test(normalized)) return "polymarket_crypto";
      if (/\b(sports|nfl|nba|mlb|nhl|ufc|soccer|football|tennis)\b/.test(normalized)) return "polymarket_sports";
      if (/\b(resolve|resolution|expiry|expiration|settlement)\b/.test(normalized)) return "polymarket_resolution";
      return String(existing.topicAffinityId || "polymarket_general");
    },
  },
  coinbase: {
    ttlEnvKey: "NOVA_STC_TTL_COINBASE_MS",
    ttlDefaultMs: 180000,
    continueRegex: COINBASE_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(portfolio|holdings|wallet|balances?)\b/.test(normalized)) return "coinbase_portfolio";
      if (/\b(pnl|profit|loss|performance)\b/.test(normalized)) return "coinbase_performance";
      if (/\b(transaction|history|activity)\b/.test(normalized)) return "coinbase_transactions";
      return String(existing.topicAffinityId || "coinbase_general");
    },
  },
  gmail: {
    ttlEnvKey: "NOVA_STC_TTL_GMAIL_MS",
    ttlDefaultMs: 180000,
    continueRegex: GMAIL_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(unread|latest|new)\s+(emails?|messages?)\b/.test(normalized)) return "gmail_unread";
      if (/\b(reply|respond)\b/.test(normalized)) return "gmail_reply";
      if (/\b(send|draft|compose)\b/.test(normalized)) return "gmail_compose";
      return String(existing.topicAffinityId || "gmail_general");
    },
  },
  telegram: {
    ttlEnvKey: "NOVA_STC_TTL_TELEGRAM_MS",
    ttlDefaultMs: 180000,
    continueRegex: TELEGRAM_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(send|post|deliver)\b/.test(normalized)) return "telegram_send";
      if (/\b(status|connected|connection)\b/.test(normalized)) return "telegram_status";
      return String(existing.topicAffinityId || "telegram_general");
    },
  },
  discord: {
    ttlEnvKey: "NOVA_STC_TTL_DISCORD_MS",
    ttlDefaultMs: 180000,
    continueRegex: DISCORD_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(send|post|deliver)\b/.test(normalized)) return "discord_send";
      if (/\b(status|connected|connection)\b/.test(normalized)) return "discord_status";
      return String(existing.topicAffinityId || "discord_general");
    },
  },
  calendar: {
    ttlEnvKey: "NOVA_STC_TTL_CALENDAR_MS",
    ttlDefaultMs: 180000,
    continueRegex: CALENDAR_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(reschedule|move|change|shift)\b/.test(normalized)) return "calendar_reschedule";
      if (/\b(today|tomorrow|this week|next week)\b/.test(normalized)) return "calendar_agenda";
      return String(existing.topicAffinityId || "calendar_general");
    },
  },
  reminders: {
    ttlEnvKey: "NOVA_STC_TTL_REMINDERS_MS",
    ttlDefaultMs: 180000,
    continueRegex: REMINDER_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(set|add|create)\b/.test(normalized)) return "reminder_create";
      if (/\b(update|change|edit|reschedule)\b/.test(normalized)) return "reminder_update";
      if (/\b(remove|delete|cancel)\b/.test(normalized)) return "reminder_remove";
      return String(existing.topicAffinityId || "reminder_general");
    },
  },
  web_research: {
    ttlEnvKey: "NOVA_STC_TTL_WEB_RESEARCH_MS",
    ttlDefaultMs: 180000,
    continueRegex: WEB_RESEARCH_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(citation|source|sources)\b/.test(normalized)) return "web_research_citations";
      if (/\b(latest|today|current)\b/.test(normalized)) return "web_research_freshness";
      return String(existing.topicAffinityId || "web_research_general");
    },
  },
  crypto: {
    ttlEnvKey: "NOVA_STC_TTL_CRYPTO_MS",
    ttlDefaultMs: 120000,
    continueRegex: CRYPTO_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(price|quote|ticker)\b/.test(normalized)) return "crypto_price";
      if (/\b(transaction|history|activity)\b/.test(normalized)) return "crypto_transactions";
      if (/\b(portfolio|account|balance|holdings)\b/.test(normalized)) return "crypto_portfolio";
      if (/\b(report|summary|pnl|daily|weekly)\b/.test(normalized)) return "crypto_report";
      return String(existing.topicAffinityId || "crypto_general");
    },
  },
  market: {
    ttlEnvKey: "NOVA_STC_TTL_MARKET_MS",
    ttlDefaultMs: 180000,
    continueRegex: MARKET_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(weather)\b/.test(normalized)) return "market_weather";
      if (/\b(stocks?|indices?|nasdaq|dow|s&p)\b/.test(normalized)) return "market_equities";
      return String(existing.topicAffinityId || "market_general");
    },
  },
  image: {
    ttlEnvKey: "NOVA_STC_TTL_IMAGE_MS",
    ttlDefaultMs: 180000,
    continueRegex: IMAGE_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(generate|create|make|draw|render|design|illustrate)\b/.test(normalized)) return "image_generation";
      if (/\b(analyze|describe|inspect|what(?:'s| is)\s+in)\b/.test(normalized)) return "image_analysis";
      return String(existing.topicAffinityId || "image_general");
    },
  },
  files: {
    ttlEnvKey: "NOVA_STC_TTL_FILES_MS",
    ttlDefaultMs: 180000,
    continueRegex: FILES_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(open|read|show)\b/.test(normalized)) return "files_open";
      if (/\b(list|search|find)\b/.test(normalized)) return "files_search";
      return String(existing.topicAffinityId || "files_general");
    },
  },
  memory: {
    ttlEnvKey: "NOVA_STC_TTL_MEMORY_MS",
    ttlDefaultMs: 120000,
    continueRegex: MEMORY_CONTINUE_REGEX,
    resolveTopicAffinityId: (_text, existing = {}) => String(existing.topicAffinityId || "memory_general"),
  },
  shutdown: {
    ttlEnvKey: "NOVA_STC_TTL_SHUTDOWN_MS",
    ttlDefaultMs: 60000,
    continueRegex: SHUTDOWN_CONTINUE_REGEX,
    resolveTopicAffinityId: (_text, existing = {}) => String(existing.topicAffinityId || "shutdown_general"),
  },
  diagnostics: {
    ttlEnvKey: "NOVA_STC_TTL_DIAGNOSTICS_MS",
    ttlDefaultMs: 180000,
    continueRegex: DIAGNOSTICS_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(error|trace)\b/.test(normalized)) return "diagnostics_errors";
      if (/\b(latency|performance)\b/.test(normalized)) return "diagnostics_latency";
      return String(existing.topicAffinityId || "diagnostics_general");
    },
  },
  voice: {
    ttlEnvKey: "NOVA_STC_TTL_VOICE_MS",
    ttlDefaultMs: 180000,
    continueRegex: VOICE_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(mute|unmute)\b/.test(normalized)) return "voice_mute_toggle";
      if (/\b(mic|microphone)\b/.test(normalized)) return "voice_mic_control";
      return String(existing.topicAffinityId || "voice_general");
    },
  },
  tts: {
    ttlEnvKey: "NOVA_STC_TTL_TTS_MS",
    ttlDefaultMs: 180000,
    continueRegex: TTS_CONTINUE_REGEX,
    resolveTopicAffinityId: (text, existing = {}) => {
      const normalized = String(text || "").toLowerCase();
      if (/\b(read|speak)\b/.test(normalized)) return "tts_read_aloud";
      return String(existing.topicAffinityId || "tts_general");
    },
  },
};

const LANE_POLICIES = {};
for (const lane of OPERATOR_LANE_SEQUENCE) {
  const definition = LANE_POLICY_DEFINITIONS[lane.domainId];
  if (!definition) continue;
  LANE_POLICIES[lane.domainId] = createPolicy({
    domainId: lane.domainId,
    ttlEnvKey: definition.ttlEnvKey,
    ttlDefaultMs: definition.ttlDefaultMs,
    continueRegex: definition.continueRegex,
    resolveTopicAffinityId: definition.resolveTopicAffinityId,
  });
}

const POLICIES = {
  ...CORE_POLICIES,
  ...LANE_POLICIES,
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
