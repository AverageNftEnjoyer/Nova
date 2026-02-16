export interface MessageLike {
  role: string;
  content: unknown;
  meta?: Record<string, unknown>;
}

function isCompactionSummary(message: MessageLike): boolean {
  if (message.role !== "system") return false;
  if (message.meta?.kind === "compaction_summary") return true;
  if (typeof message.content === "string") {
    return message.content.startsWith("[COMPACTION_SUMMARY]");
  }
  return false;
}

export function limitHistoryTurns<T extends MessageLike>(messages: T[], maxTurns: number): T[] {
  if (!Number.isFinite(maxTurns) || maxTurns <= 0 || messages.length === 0) {
    return messages;
  }

  const prefix: T[] = [];
  let idx = 0;
  while (idx < messages.length && isCompactionSummary(messages[idx] as MessageLike)) {
    prefix.push(messages[idx] as T);
    idx += 1;
  }

  const body = messages.slice(idx);
  let userTurns = 0;
  let startIndex = body.length;

  for (let i = body.length - 1; i >= 0; i -= 1) {
    const msg = body[i];
    if (!msg) continue;
    if (msg.role === "user") {
      userTurns += 1;
      if (userTurns > maxTurns) {
        break;
      }
      startIndex = i;
    }
  }

  return [...prefix, ...body.slice(startIndex)];
}

export function getHistoryLimit(sessionKey: string, config: { dmHistoryTurns: number; maxHistoryTurns: number }): number {
  return sessionKey.includes(":group:") ? config.maxHistoryTurns : config.dmHistoryTurns;
}
