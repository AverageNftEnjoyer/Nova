import { Worker } from "node:worker_threads";
import { fetchWithSsrfGuard, readResponseTextWithLimit } from "../net-guard/index.js";
import { truncateInline } from "../../core/output-caps/index.js";
import type { Tool } from "../../core/types/index.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const FETCH_MAX_ERROR_BYTES = 64_000;
const FETCH_MAX_REDIRECTS = 3;
// Default 5 s. The floor is low on purpose: a timeout no longer fails the call (it falls back to plain text, see
// extractPlainTextFallback), and the smoke sets a tiny value to force that fallback deterministically.
const WEB_FETCH_PARSE_WORKER_TIMEOUT_MS = Math.max(
  50,
  Math.min(
    15_000,
    Number.parseInt(process.env.NOVA_WEB_FETCH_PARSE_WORKER_TIMEOUT_MS || "5000", 10)
      || 5_000,
  ),
);

type ParsedHtmlResult = {
  title: string;
  markdown: string;
};

type WorkerParsedHtmlResponse =
  | { ok: true; title: string; markdown: string }
  | { ok: false; error: string };

// FETCH_MAX_RESPONSE_BYTES bounds the download; the result is capped by the executor (core/output-caps).

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
}): Promise<ParsedHtmlResult & { fallbackReason?: string }> {
  try {
    return await parseHtmlToMarkdownWithWorker(params);
  } catch (err) {
    // A slow or failing readability parse (large real pages) must not turn a successful download into an error:
    // return the page's plain text instead, with a note saying so.
    const reason = err instanceof Error ? err.message : String(err);
    return { ...extractPlainTextFallback(params.html, params.fallbackTitle), fallbackReason: reason };
  }
}

// Elements whose content is never readable text; everything up to the matching close tag is dropped.
// (`title` is read separately before its content is skipped.)
const FALLBACK_SKIPPED_ELEMENTS = new Set(["script", "style", "noscript", "template", "svg", "iframe", "object", "title"]);
// Tags that end a line of text, so paragraphs and list items do not run together.
const FALLBACK_BLOCK_ELEMENTS = new Set([
  "p", "br", "div", "li", "ul", "ol", "tr", "table", "section", "article", "header", "footer", "main", "nav",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "hr", "dd", "dt", "figcaption",
]);
const FALLBACK_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
};
const FALLBACK_TITLE_MAX_CHARS = 500;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith("#")) {
      const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return FALLBACK_NAMED_ENTITIES[lower] ?? entity;
  });
}

function readTagName(html: string, from: number): string {
  let end = from;
  while (end < html.length && end - from < 32 && /[a-zA-Z0-9-]/.test(html[end] ?? "")) end += 1;
  return html.slice(from, end).toLowerCase();
}

/** Index of the next `</name` at or after `from` (case-insensitive), or -1. A literal search: linear, no backtracking. */
function indexOfCloseTag(html: string, name: string, from: number): number {
  const pattern = new RegExp(`</${name}(?![a-zA-Z0-9-])`, "ig");
  pattern.lastIndex = from;
  return pattern.exec(html)?.index ?? -1;
}

/**
 * Cheap plain-text extraction used when the readability worker times out or fails. One linear pass over the
 * already-downloaded HTML (bounded by FETCH_MAX_RESPONSE_BYTES): comments and script/style-like elements are dropped,
 * other tags removed, block tags become line breaks, common entities are decoded and whitespace is collapsed. The
 * result is capped by the executor like any web_fetch result.
 */
export function extractPlainTextFallback(html: string, fallbackTitle: string): ParsedHtmlResult {
  const source = html.slice(0, FETCH_MAX_RESPONSE_BYTES);
  const parts: string[] = [];
  let title = "";
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    if (open < 0) {
      parts.push(source.slice(cursor));
      break;
    }
    if (open > cursor) parts.push(source.slice(cursor, open));
    if (source.startsWith("<!--", open)) {
      const close = source.indexOf("-->", open + 4);
      cursor = close < 0 ? source.length : close + 3;
      continue;
    }
    const isClosing = source[open + 1] === "/";
    const name = readTagName(source, open + (isClosing ? 2 : 1));
    if (!name && !isClosing && source[open + 1] !== "!" && source[open + 1] !== "?") {
      // A lone "<" in text ("a < b").
      parts.push("<");
      cursor = open + 1;
      continue;
    }
    const tagEnd = source.indexOf(">", open + 1);
    if (tagEnd < 0) break; // unterminated tag at the end of the document
    cursor = tagEnd + 1;
    if (!name) continue; // <!DOCTYPE ...>, <?xml ...?>, </>
    if (isClosing) {
      if (FALLBACK_BLOCK_ELEMENTS.has(name)) parts.push("\n");
      continue;
    }
    if (name === "title" && !title) {
      const titleEnd = indexOfCloseTag(source, "title", cursor);
      const raw = source.slice(cursor, Math.min(titleEnd < 0 ? source.length : titleEnd, cursor + FALLBACK_TITLE_MAX_CHARS));
      title = decodeEntities(raw).replace(/\s+/g, " ").trim();
    }
    if (FALLBACK_SKIPPED_ELEMENTS.has(name) && source[tagEnd - 1] !== "/") {
      const closeAt = indexOfCloseTag(source, name, cursor);
      if (closeAt < 0) break; // unclosed <script>: the rest is not text
      const closeEnd = source.indexOf(">", closeAt);
      cursor = closeEnd < 0 ? source.length : closeEnd + 1;
      continue;
    }
    if (FALLBACK_BLOCK_ELEMENTS.has(name)) parts.push("\n");
  }
  const text = decodeEntities(parts.join(""))
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v\r ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title: title || fallbackTitle, markdown: text };
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
          return `web_fetch error (${response.status}): ${truncateInline(message, 800)}`;
        }

        const html = await readResponseTextWithLimit(response, FETCH_MAX_RESPONSE_BYTES);
        const { title, markdown: parsedMarkdown, fallbackReason } = await parseHtmlToMarkdown({
          html,
          finalUrl,
          fallbackTitle: parsed.hostname,
        });
        // The note goes before the body so the output cap never cuts it.
        const note = fallbackReason
          ? `Note: readable extraction failed (${truncateInline(fallbackReason, 200)}); showing the page's plain text without formatting.\n\n`
          : "";
        return `# ${title}\n\nSource: ${finalUrl}\n\n${note}${parsedMarkdown.trim()}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `web_fetch error: ${message}`;
      }
    },
  };
}
