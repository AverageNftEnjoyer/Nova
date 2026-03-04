function isBlockedNonMusicPlayIntent(text) {
  return /\bplay\s+(a |the )?(game|video|clip|movie|film|role|part)\b/i.test(text);
}

function isLikelyYouTubeTopicPrompt(normalized) {
  return (
    /\bshow\s+me\s+info\s+on\s+.+/i.test(normalized)
    || /\b(show|find|get|pull)\s+(me\s+)?(news|video|videos|broadcast|broadcasts)\s+(about|on|for)\s+.+/i.test(normalized)
    || /\b(youtube|you tube)\s+(news|video|videos|broadcast|broadcasts)\s+(about|on|for)\s+.+/i.test(normalized)
    || /\b(watch|show)\s+(news|video|videos|broadcast|broadcasts)\s+(about|on|for)\s+.+/i.test(normalized)
  );
}

export function isSpotifyDirectIntent(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return false;
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

export function isSpotifyContextualFollowUpIntent(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    /\b(what(?:'s| is)\s+it\s+called|what(?:'s| is)\s+that\s+called|who\s+sings\s+(?:it|that|this)|who(?:'s| is)\s+singing|what\s+track\s+is\s+(?:that|this)|that\s+song|this\s+song|that\s+track|this\s+track|playing\s+it)\b/i.test(normalized)
    || /\b(next|previous|prev|skip|go back|restart|replay|start over|from the beginning)\b/i.test(normalized)
    || /\b(you(?:'| a)?re|your)\s+the\s+one\s+playing\s+it\b/i.test(normalized)
  );
}

export function isYouTubeDirectIntent(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    /\b(youtube|you tube)\b/i.test(normalized)
    || /\b(next\s+video|another\s+video|refresh\s+youtube|update\s+youtube)\b/i.test(normalized)
    || isLikelyYouTubeTopicPrompt(normalized)
  );
}

export function isYouTubeContextualFollowUpIntent(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    /\b(next|another|different)\s+(video|news|clip|broadcast)\b/i.test(normalized)
    || /\bmore\s+(about|on)\s+.+/i.test(normalized)
    || /\bswitch\s+(the\s+)?(youtube\s+)?topic\s+(to|about)\s+.+/i.test(normalized)
  );
}
