function normalizeIntentText(text) {
  return String(text || "").trim().toLowerCase();
}

function createIntentMatcher(matchers = []) {
  return (text) => {
    const normalized = normalizeIntentText(text);
    if (!normalized) return false;
    return matchers.some((matcher) => {
      if (typeof matcher === "function") return matcher(normalized) === true;
      return matcher instanceof RegExp && matcher.test(normalized);
    });
  };
}

function isBlockedNonMusicPlayIntent(text) {
  return /\bplay\s+(a |the )?(game|video|clip|movie|film|role|part)\b/i.test(text);
}

const YOUTUBE_KEYWORD_REGEX = /\b(?:youtube|you\s*tube|ytube|yotube)\b/i;

function hasYouTubeKeyword(normalized) {
  return YOUTUBE_KEYWORD_REGEX.test(normalized);
}

function isLikelyYouTubeTopicPrompt(normalized) {
  return (
    /\bshow\s+me\s+info\s+on\s+.+/i.test(normalized)
    || /\b(show|find|get|pull)\s+(me\s+)?(news|video|videos|broadcast|broadcasts)\s+(about|on|for)\s+.+/i.test(normalized)
    || /\b(?:youtube|you\s*tube|ytube|yotube)\s+(news|video|videos|broadcast|broadcasts)\s+(about|on|for)\s+.+/i.test(normalized)
    || /\b(watch|show)\s+(news|video|videos|broadcast|broadcasts)\s+(about|on|for)\s+.+/i.test(normalized)
  );
}

function isLikelyPolymarketTopicPrompt(normalized) {
  return (
    /\b(polymarket|prediction market|prediction markets)\b/i.test(normalized)
    || /\b(show|find|get|pull)\s+(me\s+)?(odds|markets|contracts)\s+(about|on|for)\s+.+/i.test(normalized)
    || /\bwhat\s+are\s+the\s+odds\s+(for|on)\s+.+/i.test(normalized)
    || /\b(event|yes\/no)\s+contract\b/i.test(normalized)
  );
}

function isLikelyCoinbasePrompt(normalized) {
  return (
    /\bcoinbase\b/i.test(normalized)
    || /\b(crypto\s+)?portfolio\b/i.test(normalized)
    || /\b(wallet|holdings|balances?)\b/i.test(normalized)
    || /\b(pnl|profit|loss)\b/i.test(normalized)
  );
}

function isLikelyGmailPrompt(normalized) {
  return (
    /\bgmail\b/i.test(normalized)
    || /\binbox\b/i.test(normalized)
    || /\b(email|e-mail)\b/i.test(normalized)
    || /\b(send|draft|reply)\s+(an?\s+)?email\b/i.test(normalized)
  );
}

function isLikelyTelegramPrompt(normalized) {
  return (
    /\btelegram\b/i.test(normalized)
    || /\b(chat\s+id|bot\s+token)\b/i.test(normalized)
    || /\b(send|post)\s+(to\s+)?telegram\b/i.test(normalized)
  );
}

function isLikelyDiscordPrompt(normalized) {
  return (
    /\bdiscord\b/i.test(normalized)
    || /\bwebhook\b/i.test(normalized)
    || /\b(send|post)\s+(to\s+)?discord\b/i.test(normalized)
  );
}

function isLikelyCalendarPrompt(normalized) {
  return (
    /\bcalendar\b/i.test(normalized)
    || /\bmeeting\b/i.test(normalized)
    || /\b(reschedule|schedule|availability)\b/i.test(normalized)
  );
}

function isLikelyReminderPrompt(normalized) {
  return (
    /\b(remind me|reminder)\b/i.test(normalized)
    || /\bset\s+(a\s+)?reminder\b/i.test(normalized)
    || /\bdon'?t\s+let\s+me\s+forget\b/i.test(normalized)
  );
}

function isLikelyWebResearchPrompt(normalized) {
  return (
    /\b(search|look up|research|find sources|with citations?|cite)\b/i.test(normalized)
    || /\bwhat\s+is\s+the\s+latest\s+on\b/i.test(normalized)
    || /\bweb\s+search\b/i.test(normalized)
  );
}

function isLikelyCryptoPrompt(normalized) {
  return (
    /\b(crypto|bitcoin|btc|ethereum|eth|solana|sol|altcoin)\b/i.test(normalized)
    || /\b(coin|token)\s+price\b/i.test(normalized)
  );
}

function isLikelyMarketPrompt(normalized) {
  return (
    /\b(market|stocks?|indices?|nasdaq|s&p|dow|futures)\b/i.test(normalized)
    || /\bweather\b/i.test(normalized)
    || /\b(price action|trend)\b/i.test(normalized)
  );
}

function isLikelyFilesPrompt(normalized) {
  return (
    /\b(file|files|folder|directory|workspace|project)\b/i.test(normalized)
    || /\b(read|open|list|search)\s+(file|folder|directory)\b/i.test(normalized)
  );
}

function isLikelyDiagnosticsPrompt(normalized) {
  return (
    /\b(diagnostic|diagnostics|debug|trace|health check|latency)\b/i.test(normalized)
    || /\b(system\s+status|runtime\s+status)\b/i.test(normalized)
  );
}

function isLikelyVoicePrompt(normalized) {
  return (
    /\bvoice\b/i.test(normalized)
    || /\bmic(rophone)?\b/i.test(normalized)
    || /\bmute|unmute\b/i.test(normalized)
  );
}

function isLikelyTtsPrompt(normalized) {
  return (
    /\btext to speech|tts\b/i.test(normalized)
    || /\bread\s+(this|that)\s+aloud\b/i.test(normalized)
    || /\bspeak\s+this\b/i.test(normalized)
    || /\b(set|use|switch|change)\s+(the\s+)?(?:tts\s+)?voice\s+(to|as)\b/i.test(normalized)
    || /\b(tts|voice)\s+(status|settings)\b/i.test(normalized)
  );
}

function isLikelyMemoryPrompt(normalized) {
  return (
    /\bremember this\b/i.test(normalized)
    || /\bupdate (your )?memory\b/i.test(normalized)
    || /\bsave this to memory\b/i.test(normalized)
    || /\bstore this\b/i.test(normalized)
  );
}

function isLikelyShutdownPrompt(normalized) {
  return (
    /\bshutdown nova\b/i.test(normalized)
    || /\bnova shut ?down\b/i.test(normalized)
    || /\bshutdown\b/i.test(normalized)
  );
}

export function isSpotifyDirectIntent(text) {
  const normalized = normalizeIntentText(text);
  if (!normalized) return false;
  if (hasYouTubeKeyword(normalized) && !normalized.includes("spotify")) return false;
  return (
    normalized.includes("spotify")
    || normalized.includes("play music")
    || normalized.includes("play some")
    || normalized.includes("put on ")
    || /\b(switch|change)\s+(the\s+)?(song|track|music)\s+(to|into)\s+/i.test(normalized)
    || /\b(switch|change)\s+to\s+.+\s+by\s+/i.test(normalized)
    || /\bplay\s+(my |one of my |a |the )?(favorite|liked|saved|default|playlist|song|track|album|artist)/i.test(normalized)
    || /\b(my\s+favorite\s+playlist\s+is(?:\s+called)?|set\s+(?:my\s+)?favorite\s+playlist\s+to|make\s+.+\s+my\s+favorite\s+playlist)\b/i.test(normalized)
    || /\b(clear|remove|unset|forget|unfavorite)\s+(my\s+)?favorite\s+playlist\b/i.test(normalized)
    || /\badd\s+(?:this|current|this song|this track|song|track)\b.*\b(?:to|into)\b.*\bplaylist\b/i.test(normalized)
    || /\b(skip|next track|previous track|next song|last song|go back a song|pause|resume|now playing|what.?s playing|what is playing|what song.*playing|song is this.*playing|what am i listening to|currently playing|playing currently|shuffle|repeat|queue|restart|replay|start over|from the beginning|retsrat|retsart|restat)\b/i.test(normalized)
    || /\b(you(?:'| a)?re|your)\s+the\s+one\s+playing\s+it\b/i.test(normalized)
    || (/\bretreat\b/i.test(normalized) && /\b(song|track|music)\b/i.test(normalized))
    || /\bplay\s+.+\s+by\s+/i.test(normalized)
    || (/\bplay\s+[a-z].{2,}/i.test(normalized) && !isBlockedNonMusicPlayIntent(normalized))
  );
}

export const isSpotifyContextualFollowUpIntent = createIntentMatcher([
  /\b(what(?:'s| is)\s+it\s+called|what(?:'s| is)\s+that\s+called|who\s+sings\s+(?:it|that|this)|who(?:'s| is)\s+singing|what\s+track\s+is\s+(?:that|this)|that\s+song|this\s+song|that\s+track|this\s+track|playing\s+it)\b/i,
  /\b(next|previous|prev|skip|go back|restart|replay|start over|from the beginning)\b/i,
  /\b(you(?:'| a)?re|your)\s+the\s+one\s+playing\s+it\b/i,
]);

export const isYouTubeDirectIntent = createIntentMatcher([
  hasYouTubeKeyword,
  /\b(next\s+video|another\s+video)\b/i,
  /\b(refresh|update)\s+(?:youtube|you\s*tube|ytube|yotube)\b/i,
  isLikelyYouTubeTopicPrompt,
]);

export const isYouTubeContextualFollowUpIntent = createIntentMatcher([
  /\b(next|another|different)\s+(video|news|clip|broadcast)\b/i,
  /\bmore\s+(about|on)\s+.+/i,
  /\bswitch\s+(the\s+)?(youtube\s+)?topic\s+(to|about)\s+.+/i,
]);

const DIRECT_INTENT_MATCHERS = {
  polymarket: [isLikelyPolymarketTopicPrompt, /\b(polymarket)\s+(refresh|update|scan)\b/i],
  coinbase: [isLikelyCoinbasePrompt, /\b(coinbase)\s+(refresh|update|sync|check)\b/i],
  gmail: [isLikelyGmailPrompt, /\b(gmail)\s+(refresh|check|scan)\b/i],
  telegram: [isLikelyTelegramPrompt, /\b(telegram)\s+(refresh|check|status)\b/i],
  discord: [isLikelyDiscordPrompt, /\b(discord)\s+(refresh|check|status)\b/i],
  calendar: [isLikelyCalendarPrompt, /\b(calendar)\s+(refresh|check|status)\b/i],
  reminder: [isLikelyReminderPrompt, /\b(reminder)\s+(refresh|check|status)\b/i],
  webResearch: [isLikelyWebResearchPrompt, /\b(search\s+the\s+web|look\s+it\s+up|do\s+research)\b/i],
  crypto: [isLikelyCryptoPrompt, /\b(crypto)\s+(refresh|update|scan)\b/i],
  market: [isLikelyMarketPrompt, /\b(market)\s+(refresh|update|scan)\b/i],
  files: [isLikelyFilesPrompt, /\b(files?)\s+(refresh|scan|index)\b/i],
  diagnostics: [isLikelyDiagnosticsPrompt, /\b(run|check)\s+diagnostics\b/i],
  memory: [isLikelyMemoryPrompt, /\b(memory)\s+(update|save|store)\b/i],
  shutdown: [isLikelyShutdownPrompt, /\b(power|system)\s+down\b/i],
  voice: [isLikelyVoicePrompt, /\b(voice)\s+(refresh|status|settings)\b/i],
  tts: [isLikelyTtsPrompt, /\b(tts)\s+(refresh|status|settings)\b/i],
};

const FOLLOW_UP_INTENT_MATCHERS = {
  polymarket: [
    /\b(next|another|different)\s+(market|contract)\b/i,
    /\bmore\s+(odds|markets|contracts)\b/i,
    /\brefresh\s+(polymarket|market\s+odds)\b/i,
    /\bswitch\s+(the\s+)?(market|topic)\s+(to|about)\s+.+/i,
  ],
  coinbase: [
    /\b(refresh|update|again|latest)\b/i,
    /\bmore\s+(detail|details)\b/i,
    /\b(what\s+about|and)\s+(btc|eth|sol|portfolio|balances?)\b/i,
  ],
  gmail: [
    /\b(reply|respond|draft|send\s+it)\b/i,
    /\b(unread|latest|new)\s+(emails?|messages?)\b/i,
    /\bmore\s+(detail|details)\b/i,
  ],
  telegram: [
    /\b(send|post|deliver|retry)\b/i,
    /\bstatus|connected|connection\b/i,
    /\bmore\s+(detail|details)\b/i,
  ],
  discord: [
    /\b(send|post|deliver|retry)\b/i,
    /\bstatus|connected|connection\b/i,
    /\bmore\s+(detail|details)\b/i,
  ],
  calendar: [
    /\b(reschedule|move|change|shift)\b/i,
    /\b(today|tomorrow|this week|next week)\b/i,
    /\bmore\s+(detail|details)\b/i,
  ],
  reminder: [
    /\b(when|at|on|tomorrow|today|tonight)\b/i,
    /\b(update|change|edit|remove|cancel)\b/i,
    /\bmore\s+(detail|details)\b/i,
  ],
  webResearch: [
    /\bmore\s+sources\b/i,
    /\badd\s+citations?\b/i,
    /\bdig\s+deeper\b/i,
    /\brefresh\s+search\b/i,
  ],
  crypto: [
    /\b(refresh|update|again|latest)\b/i,
    /\bmore\s+(detail|details)\b/i,
    /\b(what\s+about|and)\s+(btc|eth|sol)\b/i,
  ],
  market: [
    /\b(refresh|update|again|latest)\b/i,
    /\bmore\s+(detail|details)\b/i,
    /\b(what\s+about|and)\s+(nasdaq|dow|s&p|weather)\b/i,
  ],
  files: [
    /\b(open|read|show|list|search)\b/i,
    /\bmore\s+(detail|details)\b/i,
    /\bnext\s+file\b/i,
  ],
  diagnostics: [
    /\b(refresh|rerun|again|latest)\b/i,
    /\bmore\s+(detail|details)\b/i,
    /\b(error|latency|trace)\b/i,
  ],
  memory: [
    /\bremember (that|this)\b/i,
    /\bupdate memory\b/i,
    /\bsave (it|that|this)\b/i,
  ],
  shutdown: [
    /\byes\b/i,
    /\bconfirm\b/i,
    /\bdo it\b/i,
  ],
  voice: [
    /\b(mute|unmute|mic|microphone)\b/i,
    /\bmore\s+(detail|details)\b/i,
  ],
  tts: [
    /\b(read|speak|voice)\b/i,
    /\bmore\s+(detail|details)\b/i,
  ],
};

export const isPolymarketDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.polymarket);
export const isPolymarketContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.polymarket);
export const isCoinbaseDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.coinbase);
export const isCoinbaseContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.coinbase);
export const isGmailDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.gmail);
export const isGmailContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.gmail);
export const isTelegramDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.telegram);
export const isTelegramContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.telegram);
export const isDiscordDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.discord);
export const isDiscordContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.discord);
export const isCalendarDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.calendar);
export const isCalendarContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.calendar);
export const isReminderDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.reminder);
export const isReminderContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.reminder);
export const isWebResearchDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.webResearch);
export const isWebResearchContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.webResearch);
export const isCryptoDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.crypto);
export const isCryptoContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.crypto);
export const isMarketDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.market);
export const isMarketContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.market);
export const isFilesDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.files);
export const isFilesContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.files);
export const isDiagnosticsDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.diagnostics);
export const isDiagnosticsContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.diagnostics);
export const isMemoryDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.memory);
export const isMemoryContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.memory);
export const isShutdownDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.shutdown);
export const isShutdownContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.shutdown);
export const isVoiceDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.voice);
export const isVoiceContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.voice);
export const isTtsDirectIntent = createIntentMatcher(DIRECT_INTENT_MATCHERS.tts);
export const isTtsContextualFollowUpIntent = createIntentMatcher(FOLLOW_UP_INTENT_MATCHERS.tts);
