function normalizeWakeText(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createWakeWordRuntime({ wakeWord, wakeWordVariants }) {
  const normalizedWakeWord = String(wakeWord || "nova").trim().toLowerCase();
  const baseVariantSet = new Set(
    (Array.isArray(wakeWordVariants) ? wakeWordVariants : [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (normalizedWakeWord) {
    baseVariantSet.add(normalizedWakeWord);
  }
  let assistantVariantSet = new Set();
  let primaryWakeWord = normalizedWakeWord || "nova";

  function getAllVariants() {
    return new Set([...baseVariantSet, ...assistantVariantSet]);
  }

  function isWakeToken(token) {
    if (!token) return false;
    return getAllVariants().has(token);
  }

  function setAssistantName(value) {
    const normalized = normalizeWakeText(value);
    if (!normalized) {
      assistantVariantSet = new Set();
      primaryWakeWord = normalizedWakeWord || "nova";
      return false;
    }

    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length === 0) {
      assistantVariantSet = new Set();
      primaryWakeWord = normalizedWakeWord || "nova";
      return false;
    }

    assistantVariantSet = new Set(tokens);
    primaryWakeWord = tokens[0];
    return true;
  }

  function getPrimaryWakeWord() {
    return primaryWakeWord || normalizedWakeWord || "nova";
  }

  function getWakeWords() {
    return Array.from(getAllVariants());
  }

  function containsWakeWord(input) {
    const normalized = normalizeWakeText(input);
    if (!normalized) return false;

    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length === 0) return false;
    const filler = new Set(["hey", "hi", "hello", "yo", "ok", "okay", "please"]);
    let i = 0;
    while (i < tokens.length && filler.has(tokens[i])) i += 1;
    return i < tokens.length && isWakeToken(tokens[i]);
  }

  function stripWakePrompt(input) {
    const normalized = normalizeWakeText(input);
    if (!normalized) return "";
    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length === 0) return "";

    const filler = new Set(["hey", "hi", "hello", "yo", "ok", "okay", "please"]);
    let i = 0;
    while (i < tokens.length && filler.has(tokens[i])) i += 1;
    if (i >= tokens.length || !isWakeToken(tokens[i])) return "";
    i += 1;
    // Some STT passes produce repeated wake words ("nova nova").
    // Treat repeated wake-token prefixes as wake-only so we don't send "nova" to chat.
    while (i < tokens.length && (filler.has(tokens[i]) || isWakeToken(tokens[i]))) i += 1;
    const rest = tokens.slice(i).join(" ").trim();
    return rest;
  }

  return {
    normalizeWakeText,
    containsWakeWord,
    stripWakePrompt,
    setAssistantName,
    getPrimaryWakeWord,
    getWakeWords,
  };
}
