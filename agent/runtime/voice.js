function normalizeWakeText(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createWakeWordRuntime({ wakeWord, wakeWordVariants }) {
  const normalizedWakeWord = String(wakeWord || "nova").trim().toLowerCase();
  const variantSet = new Set(
    (Array.isArray(wakeWordVariants) ? wakeWordVariants : [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (normalizedWakeWord) {
    variantSet.add(normalizedWakeWord);
  }

  function isWakeToken(token) {
    if (!token) return false;
    return variantSet.has(token);
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

    const rest = tokens.slice(i + 1).join(" ").trim();
    return rest;
  }

  return {
    normalizeWakeText,
    containsWakeWord,
    stripWakePrompt,
  };
}
