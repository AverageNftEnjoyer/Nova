// ===== Intent Detection Helpers =====
// Pure string functions — no imports required.

export function shouldBuildWorkflowFromPrompt(text) {
  const n = String(text || "").toLowerCase();
  const asksBuild = /(build|create|setup|set up|make|generate|deploy)/.test(n);
  const workflowScope = /(workflow|mission|automation|pipeline|schedule|daily report|notification)/.test(n);
  return asksBuild && workflowScope;
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

export function buildWebSearchReadableReply(query, rawResults) {
  const raw = String(rawResults || "").trim();
  if (!raw || /^web_search error/i.test(raw) || raw === "No results found.") return "";

  const blocks = raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const items = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const title = lines[0].replace(/^\[\d+\]\s*/, "").trim();
    const url = /^https?:\/\//i.test(lines[1]) ? lines[1] : "";
    const snippet = lines.slice(url ? 2 : 1).join(" ").replace(/\s+/g, " ").trim();
    if (!title && !snippet) continue;
    items.push({ title: title || "Result", url, snippet: snippet || "No snippet available." });
    if (items.length >= 3) break;
  }
  if (items.length === 0) return "";

  const out = [`Here is a quick live-web recap for: "${String(query || "").trim()}".`, ""];
  for (const item of items) {
    out.push(`- ${item.title}: ${item.snippet}`);
    if (item.url) out.push(`  Source: ${item.url}`);
  }
  return out.join("\n");
}
