export type ChatKitReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface ChatKitRuntimeConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
  reasoningEffort: ChatKitReasoningEffort;
  store: boolean;
  timeoutMs: number;
}

export interface ChatKitValidationIssue {
  field: string;
  message: string;
}

export interface ChatKitValidationResult {
  ok: boolean;
  issues: ChatKitValidationIssue[];
}

export interface ChatKitRunContext {
  userContextId: string;
  conversationId?: string;
  missionRunId?: string;
}

export interface ChatKitRunInput {
  prompt: string;
  context: ChatKitRunContext;
}

export interface ChatKitRunResult {
  ok: boolean;
  outputText: string;
  provider: "openai-chatkit";
  model: string;
  latencyMs: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  errorCode?: string;
  errorMessage?: string;
}

