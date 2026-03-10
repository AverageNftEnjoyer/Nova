import { parentPort } from "node:worker_threads";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

type WorkerParsePayload = {
  html?: string;
  finalUrl?: string;
  fallbackTitle?: string;
};

function parseHtml(payload: WorkerParsePayload): { title: string; markdown: string } {
  const html = String(payload.html || "");
  const finalUrl = String(payload.finalUrl || "https://example.com");
  const fallbackTitle = String(payload.fallbackTitle || "web");
  const dom = new JSDOM(html, { url: finalUrl });
  try {
    const document = dom.window.document;
    for (const selector of ["script", "style", "iframe", "noscript", "img", "svg"]) {
      document.querySelectorAll(selector).forEach((node) => node.remove());
    }

    const reader = new Readability(document);
    const article = reader.parse();
    const turndown = new TurndownService({ headingStyle: "atx" });
    const title = article?.title?.trim() || document.title || fallbackTitle;
    const markdown = article?.content
      ? turndown.turndown(article.content)
      : document.body?.textContent?.replace(/\s+/g, " ").trim() || "";
    return { title, markdown };
  } finally {
    dom.window.close();
  }
}

if (parentPort) {
  parentPort.on("message", (payload: WorkerParsePayload) => {
    try {
      const result = parseHtml(payload);
      parentPort?.postMessage({
        ok: true,
        title: result.title,
        markdown: result.markdown,
      });
    } catch (err) {
      parentPort?.postMessage({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
