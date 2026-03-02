import fs from "node:fs";
import path from "node:path";

type ChatKitEventStatus = "ok" | "error" | "skipped";

export interface ChatKitEventInput {
  status: ChatKitEventStatus;
  event: string;
  userContextId: string;
  conversationId?: string;
  missionRunId?: string;
  model?: string;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
  promptChars?: number;
  outputChars?: number;
  details?: Record<string, unknown>;
}

const CHATKIT_LOG_FILE = path.join(process.cwd(), "archive", "logs", "chatkit-events.jsonl");

function safeText(value: unknown, maxChars = 220): string {
  const text = String(value ?? "").replace(/\u0000/g, "").trim();
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

export function appendChatKitEvent(input: ChatKitEventInput): void {
  try {
    const payload = {
      ts: new Date().toISOString(),
      provider: "openai-chatkit",
      status: input.status,
      event: safeText(input.event, 80),
      userContextId: String(input.userContextId || "").trim(),
      conversationId: safeText(input.conversationId, 120),
      missionRunId: safeText(input.missionRunId, 120),
      model: safeText(input.model, 80),
      latencyMs: Number.isFinite(Number(input.latencyMs)) ? Number(input.latencyMs) : 0,
      errorCode: safeText(input.errorCode, 80),
      errorMessage: safeText(input.errorMessage, 220),
      promptChars: Number.isFinite(Number(input.promptChars)) ? Number(input.promptChars) : 0,
      outputChars: Number.isFinite(Number(input.outputChars)) ? Number(input.outputChars) : 0,
      details: input.details && typeof input.details === "object" ? input.details : {},
    };
    fs.mkdirSync(path.dirname(CHATKIT_LOG_FILE), { recursive: true });
    fs.appendFileSync(CHATKIT_LOG_FILE, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // Never throw from telemetry append path.
  }
}
