export function sanitizeYouTubeTopic(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return normalized || "news";
}

export function sanitizeYouTubeSource(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.&'/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

function stripYouTubeSourceClause(value) {
  const input = String(value || "").trim();
  if (!input) return input;
  return input
    .replace(/\s+(?:from|source|channel)\s*[:=]?\s*["']?[^"']{2,80}["']?\s*$/i, "")
    .replace(/^(?:from|source|channel)\s*[:=]?\s*["']?[^"']{2,80}["']?\s+(?:about|on|for)\s+/i, "")
    .trim();
}

function stripYouTubeStrictTopicClause(value) {
  return String(value || "")
    .replace(/\b(?:strict|exact(?:ly)?)\s+(?:topic|match|about|on)\b/gi, " ")
    .replace(/\bonly\s+about\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractYouTubeSourceHints(text) {
  const input = String(text || "").trim();
  if (!input) return [];
  const out = [];
  const seen = new Set();
  const add = (value) => {
    const normalized = sanitizeYouTubeSource(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };
  const quotedPattern = /\b(?:from|source|channel)\s*[:=]?\s*["']([^"']{2,80})["']/gi;
  let match = null;
  while ((match = quotedPattern.exec(input)) !== null) {
    add(match[1]);
    if (out.length >= 4) return out;
  }
  const plainPattern = /\b(?:from|source|channel)\s*[:=]?\s*([a-z0-9][a-z0-9& .'/_-]{1,64})(?=\s+(?:about|on|for)\b|[,.!?]|$)/gi;
  while ((match = plainPattern.exec(input)) !== null) {
    add(match[1]);
    if (out.length >= 4) return out;
  }
  return out;
}

function extractYouTubeTopic(text) {
  const input = String(text || "").trim();
  if (!input) return "news";
  const patterns = [
    /\b(?:youtube|you\s*tube)\s+(?:from|source|channel)\s+["']?([^"']+)["']?\s+(?:about|on|for)\s+(.+)$/i,
    /\b(?:show|find|get|pull|play)\s+(?:me\s+)?(?:youtube|you\s*tube)?\s*(?:videos?|news|broadcasts?)?\s*(?:from|source|channel)\s+["']?([^"']+)["']?\s+(?:about|on|for)\s+(.+)$/i,
    /\bshow\s+me\s+info\s+on\s+(.+)$/i,
    /\b(?:show|find|get|pull)\s+(?:me\s+)?(?:news|video|videos|broadcast|broadcasts)\s+(?:about|on|for)\s+(.+)$/i,
    /\b(?:youtube|you\s*tube)\s+(?:news|video|videos|broadcast|broadcasts)\s+(?:about|on|for)\s+(.+)$/i,
    /\b(?:youtube|you\s*tube)\s+topic\s*[:=]?\s+(.+)$/i,
    /\b(?:switch|change)\s+(?:the\s+)?(?:youtube\s+)?topic\s+(?:to|about)\s+(.+)$/i,
    /\b(?:watch|show)\s+(?:me\s+)?(.+)\s+(?:on|in)\s+youtube$/i,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    const topicCandidate = match?.[2] || match?.[1];
    if (!topicCandidate) continue;
    const topic = sanitizeYouTubeTopic(stripYouTubeStrictTopicClause(stripYouTubeSourceClause(topicCandidate)));
    if (topic) return topic;
  }

  const youtubePrefixMatch = input.match(/\b(?:youtube|you\s*tube)\s+(.+)$/i);
  if (youtubePrefixMatch?.[1]) {
    const topic = sanitizeYouTubeTopic(stripYouTubeStrictTopicClause(stripYouTubeSourceClause(youtubePrefixMatch[1])));
    if (topic) return topic;
  }
  return "news";
}

export function normalizeYouTubeIntentFallback(text) {
  const input = String(text || "").trim().toLowerCase();
  const preferredSources = extractYouTubeSourceHints(text);
  const strictSources = preferredSources.length > 0
    || /\b(?:only|strict(?:ly)?)\s+(?:from|source|channel)\b/i.test(input);
  const strictTopic = strictSources
    || /\b(?:strict|exact(?:ly)?)\s+(?:topic|match|about|on)\b/i.test(input)
    || /\bonly\s+about\b/i.test(input);
  if (!input) {
    return {
      action: "set_topic",
      topic: "news",
      preferredSources,
      strictTopic,
      strictSources,
      response: "Switching YouTube to news.",
    };
  }
  if (/\b(next|another|different)\s+(video|news|clip|broadcast)\b/i.test(input) || /\b(refresh|update)\s+youtube\b/i.test(input)) {
    return {
      action: "refresh",
      topic: "",
      preferredSources,
      strictTopic,
      strictSources,
      response: "Refreshing your YouTube feed.",
    };
  }
  const topic = extractYouTubeTopic(text);
  const replyTopic = topic.replace(/-/g, " ");
  const sourceSuffix = preferredSources.length > 0
    ? ` from ${preferredSources.join(", ")}`
    : "";
  return {
    action: "set_topic",
    topic,
    preferredSources,
    strictTopic,
    strictSources,
    response: `Switching YouTube to ${replyTopic}${sourceSuffix}.`,
  };
}
