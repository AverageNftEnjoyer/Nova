import { appendChatKitEvent } from "../observability/index.js";
import { resolveChatKitRuntimeConfig, validateChatKitRuntimeConfig } from "../config/index.js";
import type { ChatKitRunInput, ChatKitRunResult } from "../types/index.js";

type AgentsSdkModule = {
  Agent: new (params: {
    name: string;
    instructions: string;
    model: string;
    modelSettings?: {
      reasoning?: { effort?: "minimal" | "low" | "medium" | "high" };
      store?: boolean;
    };
  }) => unknown;
  Runner: new (params?: { traceMetadata?: Record<string, string> }) => {
    run: (agent: unknown, input: Array<{ role: string; content: Array<{ type: string; text: string }> }>) => Promise<{
      finalOutput?: unknown;
      finalOutputText?: string;
    }>;
  };
  withTrace: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
};

function isAgentsSdkModule(value: unknown): value is AgentsSdkModule {
  const candidate = value as Partial<AgentsSdkModule> | null;
  return Boolean(
    candidate &&
      typeof candidate === "object" &&
      typeof candidate.Agent === "function" &&
      typeof candidate.Runner === "function" &&
      typeof candidate.withTrace === "function",
  );
}

async function loadAgentsSdk(): Promise<AgentsSdkModule> {
  const moduleValue = await import("@openai/agents");
  if (!isAgentsSdkModule(moduleValue)) {
    throw new Error("OpenAI Agents SDK shape mismatch.");
  }
  return moduleValue;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? "Unknown error");
}

export async function runChatKitWorkflow(input: ChatKitRunInput): Promise<ChatKitRunResult> {
  const startedAt = Date.now();
  const config = resolveChatKitRuntimeConfig();
  const validation = validateChatKitRuntimeConfig(config);
  const userContextId = String(input?.context?.userContextId || "").trim();
  const conversationId = String(input?.context?.conversationId || "").trim();
  const missionRunId = String(input?.context?.missionRunId || "").trim();
  const prompt = String(input?.prompt || "");

  if (!userContextId) {
    return {
      ok: false,
      outputText: "",
      provider: "openai-chatkit",
      model: config.model,
      latencyMs: Date.now() - startedAt,
      errorCode: "MISSING_USER_CONTEXT",
      errorMessage: "Missing userContextId for ChatKit workflow.",
    };
  }

  if (!config.enabled) {
    appendChatKitEvent({
      status: "skipped",
      event: "chatkit.disabled",
      userContextId,
      conversationId,
      missionRunId,
      model: config.model,
      promptChars: prompt.length,
    });
    return {
      ok: false,
      outputText: "",
      provider: "openai-chatkit",
      model: config.model,
      latencyMs: Date.now() - startedAt,
      errorCode: "CHATKIT_DISABLED",
      errorMessage: "ChatKit is disabled by configuration.",
    };
  }

  if (!validation.ok) {
    const detail = validation.issues.map((item) => `${item.field}: ${item.message}`).join(" | ");
    appendChatKitEvent({
      status: "error",
      event: "chatkit.invalid_config",
      userContextId,
      conversationId,
      missionRunId,
      model: config.model,
      errorCode: "INVALID_CONFIG",
      errorMessage: detail,
      promptChars: prompt.length,
    });
    return {
      ok: false,
      outputText: "",
      provider: "openai-chatkit",
      model: config.model,
      latencyMs: Date.now() - startedAt,
      errorCode: "INVALID_CONFIG",
      errorMessage: detail,
    };
  }

  let sdk: AgentsSdkModule;
  try {
    sdk = await loadAgentsSdk();
  } catch (err) {
    const errorMessage = toErrorMessage(err);
    appendChatKitEvent({
      status: "error",
      event: "chatkit.sdk_unavailable",
      userContextId,
      conversationId,
      missionRunId,
      model: config.model,
      errorCode: "SDK_UNAVAILABLE",
      errorMessage,
      promptChars: prompt.length,
    });
    return {
      ok: false,
      outputText: "",
      provider: "openai-chatkit",
      model: config.model,
      latencyMs: Date.now() - startedAt,
      errorCode: "SDK_UNAVAILABLE",
      errorMessage,
    };
  }

  try {
    const outputText = await sdk.withTrace("Nova ChatKit Workflow", async () => {
      const agent = new sdk.Agent({
        name: "Nova ChatKit",
        instructions:
          "You are Nova. Follow system safety and user-context boundaries. Do not fabricate unavailable data.",
        model: config.model,
        modelSettings: {
          reasoning: { effort: config.reasoningEffort },
          store: config.store,
        },
      });
      const runner = new sdk.Runner({
        traceMetadata: {
          __trace_source__: "nova-chatkit",
          userContextId,
          conversationId,
          missionRunId,
        },
      });
      const result = await Promise.race([
        runner.run(agent, [{ role: "user", content: [{ type: "input_text", text: prompt }] }]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`ChatKit timed out after ${config.timeoutMs}ms`)), config.timeoutMs),
        ),
      ]);
      const direct = String(result?.finalOutputText || "").trim();
      if (direct) return direct;
      return String(result?.finalOutput ?? "").trim();
    });

    appendChatKitEvent({
      status: "ok",
      event: "chatkit.run",
      userContextId,
      conversationId,
      missionRunId,
      model: config.model,
      latencyMs: Date.now() - startedAt,
      promptChars: prompt.length,
      outputChars: outputText.length,
    });
    return {
      ok: true,
      outputText,
      provider: "openai-chatkit",
      model: config.model,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    const errorMessage = toErrorMessage(err);
    appendChatKitEvent({
      status: "error",
      event: "chatkit.run_failed",
      userContextId,
      conversationId,
      missionRunId,
      model: config.model,
      latencyMs: Date.now() - startedAt,
      errorCode: "RUN_FAILED",
      errorMessage,
      promptChars: prompt.length,
    });
    return {
      ok: false,
      outputText: "",
      provider: "openai-chatkit",
      model: config.model,
      latencyMs: Date.now() - startedAt,
      errorCode: "RUN_FAILED",
      errorMessage,
    };
  }
}
