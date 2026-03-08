import { isStandaloneCalendarCrudPrompt } from "../../../services/calendar/direct-google-events/index.js";

// ===== Intent Detection Helpers =====
// Pure string functions - no imports required.

export function shouldBuildWorkflowFromPrompt(text) {
  const n = String(text || "").toLowerCase();
  if (isStandaloneCalendarCrudPrompt(n)) return false;
  const asksBuild = /(build|create|setup|set up|make|generate|deploy)/.test(n);
  const workflowScope = /(workflow|mission|automation|pipeline|schedule|daily report|notification)/.test(n);
  return asksBuild && workflowScope;
}

export function shouldConfirmWorkflowFromPrompt(text) {
  const n = String(text || "").toLowerCase().trim();
  if (!n) return false;
  if (isStandaloneCalendarCrudPrompt(n)) return false;
  if (shouldBuildWorkflowFromPrompt(n)) return false;

  const reminderLike = /\b(remind me to|reminder to|set a reminder|remember to|dont let me forget|don't let me forget)\b/.test(n);
  const scheduleLike = /\b(every day|daily|every morning|every night|weekly|at\s+\d{1,2}(:\d{2})?\s*(am|pm)?|tomorrow morning|tomorrow night)\b/.test(n);
  const deliveryLike = /\b(to telegram|on telegram|to discord|on discord|to telegram|to chat|as a notification)\b/.test(n);
  const missionTerms = /\b(mission|workflow|automation|schedule|scheduled)\b/.test(n);
  const taskLike = /\b(quote|speech|reminder|bill|loan|payment|pay)\b/.test(n);
  const likelyQuestionOnly = /^(what|why|how|when|where)\b/.test(n) || /\b(explain|difference between)\b/.test(n);

  if (likelyQuestionOnly) return false;
  return reminderLike || (scheduleLike && (deliveryLike || taskLike)) || (missionTerms && taskLike);
}

export function shouldDraftOnlyWorkflow(text) {
  const n = String(text || "").toLowerCase();
  return /(draft|preview|don't deploy|do not deploy|just show|show me first)/.test(n);
}

export function shouldPreloadWebSearch(text) {
  const n = String(text || "").toLowerCase();
  if (!n.trim()) return false;
  return /\b(latest|most recent|today|tonight|yesterday|last night|current|breaking|update|updates|live|score|scores|recap|price|prices|market|news|weather)\b/.test(n);
}

export function replyClaimsNoLiveAccess(text) {
  const n = String(text || "").toLowerCase();
  if (!n.trim()) return false;
  return (
    n.includes("don't have live access") ||
    n.includes("do not have live access") ||
    n.includes("don't have access to the internet") ||
    n.includes("no live access to the internet") ||
    n.includes("can't access current") ||
    n.includes("cannot access current") ||
    n.includes("cannot browse") ||
    n.includes("can't browse") ||
    n.includes("without web access")
  );
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&deg;/gi, " deg ")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number.parseInt(String(n), 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function cleanSnippetText(value) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\.\.\.\s*\[truncated\]\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function parseWebSearchItems(rawResults) {
  const raw = String(rawResults || "").trim();
  if (!raw || /^web_search error/i.test(raw) || raw === "No results found.") return [];

  const blocks = raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const items = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const title = cleanSnippetText(lines[0].replace(/^\[\d+\]\s*/, "").trim()) || "Result";
    const url = /^https?:\/\//i.test(lines[1]) ? lines[1] : "";
    const snippet = cleanSnippetText(lines.slice(url ? 2 : 1).join(" "));
    if (!title && !snippet) continue;
    items.push({ title, url, snippet: snippet || "No snippet available." });
    if (items.length >= 5) break;
  }
  return items;
}

export function buildWebSearchReadableReply(query, rawResults) {
  const items = parseWebSearchItems(rawResults).slice(0, 3);
  if (items.length === 0) return "";

  const out = [`Here is a quick live-web recap for: "${String(query || "").trim()}".`, ""];
  for (const item of items) {
    out.push(`- ${item.title}: ${item.snippet}`);
  }
  return out.join("\n");
}
