import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { fetchWithSsrfGuard, readResponseTextWithLimit } from "../net-guard/index.js";
import type { Tool } from "../../core/types/index.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const FETCH_MAX_ERROR_BYTES = 64_000;
const FETCH_MAX_REDIRECTS = 3;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated]`;
}

export function createWebFetchTool(): Tool {
  return {
    name: "web_fetch",
    description: "Fetch a URL and extract readable Markdown content.",
    capabilities: ["network.fetch"],
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTP or HTTPS URL to fetch." },
      },
      required: ["url"],
      additionalProperties: false,
    },
    execute: async (input: { url?: string }) => {
      const url = String(input?.url ?? "").trim();
      if (!url) return "web_fetch error: url is required";

      const parsed = (() => {
        try {
          return new URL(url);
        } catch {
          return null;
        }
      })();
      if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
        return "web_fetch error: url must be http(s).";
      }

      try {
        const { response, finalUrl } = await fetchWithSsrfGuard({
          url: parsed.toString(),
          timeoutMs: FETCH_TIMEOUT_MS,
          maxRedirects: FETCH_MAX_REDIRECTS,
          auditContext: "web_fetch",
          policy: {
            allowPrivateNetwork: false,
          },
          init: {
            headers: {
              "User-Agent": USER_AGENT,
              Accept: "text/html,application/xhtml+xml",
            },
          },
        });

        if (!response.ok) {
          const detail = await readResponseTextWithLimit(response, FETCH_MAX_ERROR_BYTES).catch(
            () => "",
          );
          const message = detail.trim() || response.statusText || "request failed";
          return `web_fetch error (${response.status}): ${truncate(message, 800)}`;
        }

        const html = await readResponseTextWithLimit(response, FETCH_MAX_RESPONSE_BYTES);
        const dom = new JSDOM(html, { url: finalUrl });

        const document = dom.window.document;
        for (const selector of ["script", "style", "iframe", "noscript", "img", "svg"]) {
          document.querySelectorAll(selector).forEach((node) => node.remove());
        }

        const reader = new Readability(document);
        const article = reader.parse();

        const turndown = new TurndownService({ headingStyle: "atx" });
        const title = article?.title?.trim() || document.title || parsed.hostname;

        let markdown = "";
        if (article?.content) {
          markdown = turndown.turndown(article.content);
        } else {
          markdown = document.body?.textContent?.replace(/\s+/g, " ").trim() || "";
        }

        markdown = truncate(markdown.trim(), 16_000);
        return `# ${title}\n\nSource: ${finalUrl}\n\n${markdown}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `web_fetch error: ${message}`;
      }
    },
  };
}
