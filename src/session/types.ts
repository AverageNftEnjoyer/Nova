export interface SessionEntry {
  sessionId: string;
  sessionKey: string;
  updatedAt: number;
  createdAt: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  model: string;
  origin?: {
    label: string;
    provider: string;
    from: string;
    to: string;
  };
}

export interface InboundMessage {
  text: string;
  senderId: string;
  channel: string;
  chatType: "direct" | "group";
  chatId?: string;
  threadId?: string;
  timestamp: number;
}

export interface TranscriptTurn {
  role: string;
  content: unknown;
  timestamp: number;
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  meta?: Record<string, unknown>;
}

export interface ResolveSessionResult {
  sessionEntry: SessionEntry;
  isNewSession: boolean;
  sessionKey: string;
}