const SILENT_REPLY_TOKEN = "__SILENT__";

function stripControlChars(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripRedundantAssistantPrefix(value) {
  return String(value || "")
    .replace(/^\s*(assistant|nova)\s*[:\-]\s*/i, "")
    .trim();
}

function collapseDuplicateLines(value) {
  const lines = String(value || "").split("\n");
  const out = [];
  let last = "";
  let repeated = 0;
  for (const line of lines) {
    const current = line.trim();
    if (!current) {
      out.push("");
      last = "";
      repeated = 0;
      continue;
    }
    if (current === last) {
      repeated += 1;
      if (repeated >= 1) continue;
    } else {
      repeated = 0;
    }
    out.push(line);
    last = current;
  }
  return out.join("\n");
}

function sanitizeForSpeech(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, "").trim())
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/[`*_~#>]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function normalizeAssistantReply(rawText) {
  const cleanedInput = stripControlChars(rawText);
  const text = normalizeWhitespace(stripRedundantAssistantPrefix(cleanedInput));

  if (!text) {
    return { skip: true, text: "" };
  }

  if (text.toUpperCase() === SILENT_REPLY_TOKEN) {
    return { skip: true, text: "" };
  }

  const cleaned = normalizeWhitespace(collapseDuplicateLines(text));
  if (!cleaned) {
    return { skip: true, text: "" };
  }

  return { skip: false, text: cleaned };
}

export function normalizeAssistantSpeechText(rawText) {
  const normalized = normalizeAssistantReply(rawText);
  if (normalized.skip) return "";
  return sanitizeForSpeech(normalized.text);
}
