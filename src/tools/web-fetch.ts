import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import type { Tool } from "./types.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated]`;
}

export function createWebFetchTool(): Tool {
  return {
    name: "web_fetch",
    description: "Fetch a URL and extract readable Markdown content.",
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

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await fetch(parsed, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          return `web_fetch error (${response.status}): ${await response.text()}`;
        }

        const html = await response.text();
        const dom = new JSDOM(html, { url: parsed.toString() });

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
        return `# ${title}\n\nSource: ${parsed.toString()}\n\n${markdown}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `web_fetch error: ${message}`;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
