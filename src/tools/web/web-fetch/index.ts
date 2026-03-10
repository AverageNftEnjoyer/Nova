import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { Worker } from "node:worker_threads";
import TurndownService from "turndown";
import { fetchWithSsrfGuard, readResponseTextWithLimit } from "../net-guard/index.js";
import type { Tool } from "../../core/types/index.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const FETCH_MAX_ERROR_BYTES = 64_000;
const FETCH_MAX_REDIRECTS = 3;
const WEB_FETCH_PARSE_WORKER_ENABLED =
  String(process.env.NOVA_WEB_FETCH_PARSE_WORKER_ENABLED || "1").trim() !== "0";
const WEB_FETCH_PARSE_WORKER_TIMEOUT_MS = Math.max(
  1_500,
  Math.min(
    15_000,
    Number.parseInt(process.env.NOVA_WEB_FETCH_PARSE_WORKER_TIMEOUT_MS || "5000", 10)
      || 5_000,
  ),
);
const WEB_FETCH_PARSE_WORKER_MIN_HTML_BYTES = Math.max(
  48_000,
  Math.min(
    FETCH_MAX_RESPONSE_BYTES,
    Number.parseInt(process.env.NOVA_WEB_FETCH_PARSE_WORKER_MIN_HTML_BYTES || "120000", 10) || 120_000,
  ),
);

type ParsedHtmlResult = {
  title: string;
  markdown: string;
};

type WorkerParsedHtmlResponse =
  | { ok: true; title: string; markdown: string }
  | { ok: false; error: string };

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated]`;
}

function parseHtmlToMarkdownSync(params: {
  html: string;
  finalUrl: string;
  fallbackTitle: string;
}): ParsedHtmlResult {
  const dom = new JSDOM(params.html, { url: params.finalUrl });
  try {
    const document = dom.window.document;
    for (const selector of ["script", "style", "iframe", "noscript", "img", "svg"]) {
      document.querySelectorAll(selector).forEach((node) => node.remove());
    }

    const reader = new Readability(document);
    const article = reader.parse();
    const turndown = new TurndownService({ headingStyle: "atx" });
    const title = article?.title?.trim() || document.title || params.fallbackTitle;
    const markdown = article?.content
      ? turndown.turndown(article.content)
      : document.body?.textContent?.replace(/\s+/g, " ").trim() || "";
    return { title, markdown };
  } finally {
    dom.window.close();
  }
}

async function parseHtmlToMarkdownWithWorker(params: {
  html: string;
  finalUrl: string;
  fallbackTitle: string;
}): Promise<ParsedHtmlResult> {
  const worker = new Worker(new URL("./readability-worker.js", import.meta.url));
  worker.unref();

  return await new Promise<ParsedHtmlResult>((resolve, reject) => {
    let settled = false;
    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new Error(`web_fetch worker parse timed out after ${WEB_FETCH_PARSE_WORKER_TIMEOUT_MS}ms`));
    }, WEB_FETCH_PARSE_WORKER_TIMEOUT_MS);

    const finalize = () => {
      clearTimeout(timeoutHandle);
      worker.removeAllListeners("message");
      worker.removeAllListeners("error");
      worker.removeAllListeners("exit");
      void worker.terminate();
    };

    worker.once("message", (message: WorkerParsedHtmlResponse) => {
      if (settled) return;
      settled = true;
      finalize();
      if (!message || typeof message !== "object") {
        reject(new Error("web_fetch worker returned invalid payload"));
        return;
      }
      if (message.ok !== true) {
        reject(new Error(String(message.error || "web_fetch worker parse failed")));
        return;
      }
      resolve({
        title: String(message.title || "").trim(),
        markdown: String(message.markdown || ""),
      });
    });

    worker.once("error", (err) => {
      if (settled) return;
      settled = true;
      finalize();
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    worker.once("exit", (code) => {
      if (settled || code === 0) return;
      settled = true;
      finalize();
      reject(new Error(`web_fetch worker exited with code ${code}`));
    });

    worker.postMessage({
      html: params.html,
      finalUrl: params.finalUrl,
      fallbackTitle: params.fallbackTitle,
    });
  });
}

async function parseHtmlToMarkdown(params: {
  html: string;
  finalUrl: string;
  fallbackTitle: string;
}): Promise<ParsedHtmlResult> {
  if (
    !WEB_FETCH_PARSE_WORKER_ENABLED
    || params.html.length < WEB_FETCH_PARSE_WORKER_MIN_HTML_BYTES
  ) {
    return parseHtmlToMarkdownSync(params);
  }

  try {
    return await parseHtmlToMarkdownWithWorker(params);
  } catch (err) {
    console.warn(
      `[web_fetch] worker parse fallback to sync: ${err instanceof Error ? err.message : String(err)}`,
    );
    return parseHtmlToMarkdownSync(params);
  }
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
        const { title, markdown: parsedMarkdown } = await parseHtmlToMarkdown({
          html,
          finalUrl,
          fallbackTitle: parsed.hostname,
        });
        let markdown = parsedMarkdown;
        markdown = truncate(markdown.trim(), 16_000);
        return `# ${title}\n\nSource: ${finalUrl}\n\n${markdown}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `web_fetch error: ${message}`;
      }
    },
  };
}
