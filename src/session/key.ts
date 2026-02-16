import type { SessionConfig } from "../config/types.js";
import type { InboundMessage } from "./types.js";

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9:_-]/g, "-");
}

export function buildSessionKey(config: SessionConfig, agentName: string, msg: InboundMessage): string {
  const base = `agent:${normalize(agentName)}`;

  if (msg.chatType === "direct") {
    if (config.dmScope === "main") {
      return `${base}:${normalize(config.mainKey || "main")}`;
    }
    return `${base}:${normalize(msg.channel)}:dm:${normalize(msg.senderId)}`;
  }

  const chatId = normalize(msg.chatId || "unknown");
  const threadSuffix = msg.threadId ? `:thread:${normalize(msg.threadId)}` : "";
  return `${base}:${normalize(msg.channel)}:group:${chatId}${threadSuffix}`;
}