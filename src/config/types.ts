export interface AgentConfig {
  name: string;
  workspace: string;
  model: string;
  maxTokens: number;
  apiKey: string;
  bootstrapMaxChars: number;
  bootstrapTotalMaxChars: number;
}

export interface SessionConfig {
  scope: "per-sender" | "per-channel" | "per-channel-peer";
  dmScope: "main" | "per-channel-peer";
  storePath: string;
  transcriptDir: string;
  mainKey: string;
  resetMode: "daily" | "idle" | "manual";
  resetAtHour: number;
  idleMinutes: number;
  maxHistoryTurns: number;
  dmHistoryTurns: number;
}

export interface MemoryConfig {
  enabled: boolean;
  dbPath: string;
  embeddingProvider: "openai" | "local";
  embeddingModel: string;
  embeddingApiKey: string;
  chunkSize: number;
  chunkOverlap: number;
  hybridVectorWeight: number;
  hybridBm25Weight: number;
  topK: number;
  syncOnSessionStart: boolean;
  sourceDirs: string[];
}

export interface ToolsConfig {
  enabledTools: string[];
  execApprovalMode: "ask" | "auto" | "off";
  safeBinaries: string[];
  webSearchProvider: "brave";
  webSearchApiKey: string;
}

export interface Config {
  agent: AgentConfig;
  session: SessionConfig;
  memory: MemoryConfig;
  tools: ToolsConfig;
}
