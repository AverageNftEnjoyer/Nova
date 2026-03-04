import path from "path";
import { pathToFileURL } from "url";

let cachedPreprocessFn = null;
let preprocessResolved = false;

function identityPreprocess(text) {
  return { raw_text: text, clean_text: text, corrections: [], confidence: 1.0 };
}

async function resolvePreprocessFn() {
  if (preprocessResolved) return cachedPreprocessFn;
  const preprocessModuleUrl = pathToFileURL(path.join(process.cwd(), "dist", "nlp", "preprocess", "index.js")).href;
  try {
    const mod = await import(preprocessModuleUrl);
    cachedPreprocessFn = mod.preprocess ?? mod.default?.preprocess ?? identityPreprocess;
  } catch {
    cachedPreprocessFn = identityPreprocess;
  }
  preprocessResolved = true;
  return cachedPreprocessFn;
}

export async function preprocessInboundText(input = {}) {
  const {
    text = "",
    sessionKey = "",
    nlpBypass = false,
    latencyTelemetry = null,
  } = input;

  const rawText = String(text || "");
  let cleanText = rawText;
  let nlpCorrections = [];
  let nlpConfidence = 1.0;

  const startedAt = Date.now();
  if (!nlpBypass) {
    try {
      const preprocessFn = await resolvePreprocessFn();
      if (preprocessFn) {
        const nlpResult = await preprocessFn(rawText);
        cleanText = String(nlpResult?.clean_text || rawText);
        nlpCorrections = Array.isArray(nlpResult?.corrections) ? nlpResult.corrections : [];
        nlpConfidence = Number.isFinite(Number(nlpResult?.confidence))
          ? Number(nlpResult.confidence)
          : 1.0;
        if (nlpCorrections.length > 0) {
          const summary = nlpCorrections.map((c) => `${c.reason}(${Number(c.confidence || 0).toFixed(2)})`).join(", ");
          console.log(`[NLP] ${nlpCorrections.length} correction(s) session=${sessionKey}: ${summary}`);
        }
      }
    } catch {
      cleanText = rawText;
      nlpConfidence = 1.0;
      nlpCorrections = [];
    }
  }

  if (latencyTelemetry && typeof latencyTelemetry.addStage === "function") {
    latencyTelemetry.addStage("nlp_preprocess", Date.now() - startedAt);
  }

  return {
    rawText,
    cleanText,
    nlpCorrections,
    nlpConfidence,
    nlpBypass: nlpBypass === true,
  };
}

