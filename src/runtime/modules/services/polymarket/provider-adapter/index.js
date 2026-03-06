import { describeUnknownError } from "../../../llm/providers/index.js";

function hasWebSearchTool(availableTools = []) {
  return Array.isArray(availableTools) && availableTools.some((tool) => String(tool?.name || "").trim() === "web_search");
}

function parseSearchResults(rawContent = "") {
  const raw = String(rawContent || "").trim();
  if (!raw || /^web_search error:/i.test(raw) || raw === "No results found.") return [];

  return raw
    .split(/\n\s*\n(?=\[\d+\]\s)/)
    .map((block) => {
      const lines = String(block || "")
        .split("\n")
        .map((line) => String(line || "").trim())
        .filter(Boolean);
      if (lines.length < 2) return null;
      const title = lines[0].replace(/^\[\d+\]\s*/, "").trim();
      const url = String(lines[1] || "").trim();
      const snippet = lines.slice(2).join(" ").trim();
      if (!title || !url) return null;
      return { title, url, snippet };
    })
    .filter(Boolean)
    .slice(0, 5);
}

export function createPolymarketProviderAdapter(deps = {}) {
  return {
    id: "web-search-tool-adapter",
    providerId: "web_search",
    async searchMarkets(input = {}) {
      const runtimeTools = input.runtimeTools || deps.runtimeTools || null;
      const availableTools = input.availableTools || deps.availableTools || [];
      const query = String(input.query || "").trim();

      if (!query) {
        return {
          ok: false,
          code: "polymarket.query_missing",
          message: "Polymarket search query is required.",
          providerId: "web_search",
          adapterId: "web-search-tool-adapter",
          attempts: 0,
          results: [],
          raw: "",
        };
      }
      if (typeof runtimeTools?.executeToolUse !== "function") {
        return {
          ok: false,
          code: "polymarket.tool_runtime_unavailable",
          message: "Polymarket search requires the runtime tool executor.",
          providerId: "web_search",
          adapterId: "web-search-tool-adapter",
          attempts: 0,
          results: [],
          raw: "",
        };
      }
      if (!hasWebSearchTool(availableTools)) {
        return {
          ok: false,
          code: "polymarket.web_search_disabled",
          message: "Polymarket search requires the web_search tool to be enabled.",
          providerId: "web_search",
          adapterId: "web-search-tool-adapter",
          attempts: 0,
          results: [],
          raw: "",
        };
      }

      try {
        const result = await runtimeTools.executeToolUse(
          {
            id: `tool_polymarket_web_search_${Date.now()}`,
            name: "web_search",
            input: { query },
            type: "tool_use",
          },
          availableTools,
        );
        const raw = String(result?.content || "").trim();
        if (!raw) {
          return {
            ok: false,
            code: "polymarket.empty_search_response",
            message: "Polymarket search returned an empty response.",
            providerId: "web_search",
            adapterId: "web-search-tool-adapter",
            attempts: 1,
            results: [],
            raw,
          };
        }
        if (/^web_search error:/i.test(raw)) {
          return {
            ok: false,
            code: "polymarket.search_failed",
            message: raw.replace(/^web_search error:\s*/i, "").trim() || "Polymarket search failed.",
            providerId: "web_search",
            adapterId: "web-search-tool-adapter",
            attempts: 1,
            results: [],
            raw,
          };
        }

        const results = parseSearchResults(raw);
        return {
          ok: results.length > 0,
          code: results.length > 0 ? "polymarket.search_ok" : "polymarket.no_results",
          message: results.length > 0 ? "Polymarket search completed." : "No Polymarket results found.",
          providerId: "web_search",
          adapterId: "web-search-tool-adapter",
          attempts: 1,
          results,
          raw,
        };
      } catch (error) {
        return {
          ok: false,
          code: "polymarket.search_execution_failed",
          message: describeUnknownError(error),
          providerId: "web_search",
          adapterId: "web-search-tool-adapter",
          attempts: 1,
          results: [],
          raw: "",
        };
      }
    },
  };
}
