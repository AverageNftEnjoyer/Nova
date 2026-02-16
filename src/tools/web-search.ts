import type { Tool } from "./types.js";

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated]`;
}

async function searchBrave(query: string, apiKey: string): Promise<string> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (response.status === 429) {
    return "web_search error: rate limited by Brave API (429).";
  }

  if (!response.ok) {
    const detail = await response.text();
    return `web_search error (${response.status}): ${truncate(detail, 800)}`;
  }

  const payload = (await response.json()) as {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string }>;
    };
  };

  const results = payload.web?.results ?? [];
  if (results.length === 0) {
    return "No results found.";
  }

  const lines = results.slice(0, 5).map((result, index) => {
    const title = result.title?.trim() || "Untitled";
    const link = result.url?.trim() || "No URL";
    const snippet = truncate(result.description?.trim() || "", 400);
    return `[${index + 1}] ${title}\n${link}\n${snippet}`;
  });

  return truncate(lines.join("\n\n"), 6000);
}

export function createWebSearchTool(params: {
  provider: "brave";
  apiKey: string;
}): Tool {
  return {
    name: "web_search",
    description: "Search the web and return top results.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (1-6 words recommended)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (input: { query?: string }) => {
      const query = String(input?.query ?? "").trim();
      if (!query) {
        return "web_search error: query is required";
      }

      if (!params.apiKey) {
        return "web_search error: missing Brave API key.";
      }

      return searchBrave(query, params.apiKey);
    },
  };
}
