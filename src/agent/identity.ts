import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUserContextId } from "../session/key.js";

interface RuntimeIdentitySyncOutcome {
  promptSection?: string;
  persisted?: boolean;
  disabledReason?: string;
  appliedSignals?: Array<unknown>;
  rejectedSignals?: Array<unknown>;
}

interface RuntimeIdentityToolOutcome {
  promptSection?: string;
  persisted?: boolean;
  disabledReason?: string;
  toolUpdates?: Array<unknown>;
}

interface RuntimeIdentityLoadOutcome {
  promptSection?: string;
  disabledReason?: string;
}

interface RuntimeIdentityEngineModule {
  syncIdentityIntelligenceFromTurn(params: Record<string, unknown>): RuntimeIdentitySyncOutcome;
  recordIdentityToolUsage(params: Record<string, unknown>): RuntimeIdentityToolOutcome;
  loadIdentityIntelligenceSnapshot(params: Record<string, unknown>): RuntimeIdentityLoadOutcome;
}

let runtimeIdentityEnginePromise: Promise<RuntimeIdentityEngineModule> | null = null;

function resolveRuntimeIdentityEngineHref(): string {
  const enginePath = path.join(process.cwd(), "src", "runtime", "modules", "context", "identity", "engine.js");
  return pathToFileURL(enginePath).href;
}

async function loadRuntimeIdentityEngine(): Promise<RuntimeIdentityEngineModule> {
  if (!runtimeIdentityEnginePromise) {
    runtimeIdentityEnginePromise = import(resolveRuntimeIdentityEngineHref()) as Promise<RuntimeIdentityEngineModule>;
  }
  return runtimeIdentityEnginePromise;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resolveSnapshotPath(personaWorkspaceDir: string): string {
  return path.join(path.resolve(personaWorkspaceDir), "profile", "identity-intelligence.json");
}

function resolveConversationId(params: { conversationId?: string; threadId?: string; chatId?: string }): string {
  return normalizeText(params.conversationId || params.threadId || params.chatId || "");
}

export interface AgentIdentitySyncResult {
  promptSection: string;
  snapshotPath: string;
  applied: boolean;
  persisted: boolean;
  appliedSignalCount: number;
  rejectedSignalCount: number;
  toolAffinityUpdateCount: number;
  disabledReason: string;
}

export interface AgentIdentitySyncParams {
  userContextId: string;
  personaWorkspaceDir: string;
  sessionKey?: string;
  source?: string;
  conversationId?: string;
  threadId?: string;
  chatId?: string;
  userInputText?: string;
  nlpConfidence?: number;
  toolCalls?: string[];
  maxPromptTokens?: number;
  runtimeAssistantName?: string;
  runtimeCommunicationStyle?: string;
  runtimeTone?: string;
  preferenceCapture?: unknown;
}

export async function syncAgentIdentitySignals(params: AgentIdentitySyncParams): Promise<AgentIdentitySyncResult> {
  const userContextId = normalizeUserContextId(String(params.userContextId || ""));
  const personaWorkspaceDir = String(params.personaWorkspaceDir || "").trim();
  if (!userContextId || !personaWorkspaceDir) {
    return {
      promptSection: "",
      snapshotPath: "",
      applied: false,
      persisted: false,
      appliedSignalCount: 0,
      rejectedSignalCount: 0,
      toolAffinityUpdateCount: 0,
      disabledReason: "missing_user_context_or_workspace",
    };
  }

  const runtimeEngine = await loadRuntimeIdentityEngine();
  const maxPromptTokens = clamp(Number(params.maxPromptTokens || 220), 80, 800);
  const sessionKey = normalizeText(params.sessionKey || "");
  const source = normalizeText(params.source || "agent") || "agent";
  const conversationId = resolveConversationId(params);
  const snapshotPath = resolveSnapshotPath(personaWorkspaceDir);
  const userInputText = normalizeText(params.userInputText || "");
  const toolCalls = Array.isArray(params.toolCalls) ? params.toolCalls.filter((name) => normalizeText(name)) : [];

  let promptSection = "";
  let persisted = false;
  let appliedSignalCount = 0;
  let rejectedSignalCount = 0;
  let toolAffinityUpdateCount = 0;
  let disabledReason = "";

  if (userInputText) {
    const turnOutcome = runtimeEngine.syncIdentityIntelligenceFromTurn({
      userContextId,
      workspaceDir: personaWorkspaceDir,
      userInputText,
      nlpConfidence: Number.isFinite(Number(params.nlpConfidence)) ? Number(params.nlpConfidence) : 1,
      runtimeAssistantName: params.runtimeAssistantName,
      runtimeCommunicationStyle: params.runtimeCommunicationStyle,
      runtimeTone: params.runtimeTone,
      preferenceCapture: params.preferenceCapture,
      conversationId,
      sessionKey,
      source,
      maxPromptTokens,
    });
    promptSection = normalizeText(turnOutcome?.promptSection || "");
    persisted = turnOutcome?.persisted === true;
    appliedSignalCount = Array.isArray(turnOutcome?.appliedSignals) ? turnOutcome.appliedSignals.length : 0;
    rejectedSignalCount = Array.isArray(turnOutcome?.rejectedSignals) ? turnOutcome.rejectedSignals.length : 0;
    disabledReason = normalizeText(turnOutcome?.disabledReason || "");
  } else {
    const loadOutcome = runtimeEngine.loadIdentityIntelligenceSnapshot({
      userContextId,
      workspaceDir: personaWorkspaceDir,
      maxPromptTokens,
    });
    promptSection = normalizeText(loadOutcome?.promptSection || "");
    disabledReason = normalizeText(loadOutcome?.disabledReason || "");
  }

  if (toolCalls.length > 0) {
    const toolOutcome = runtimeEngine.recordIdentityToolUsage({
      userContextId,
      workspaceDir: personaWorkspaceDir,
      conversationId,
      sessionKey,
      source,
      toolCalls,
      maxPromptTokens,
    });
    const toolPromptSection = normalizeText(toolOutcome?.promptSection || "");
    if (toolPromptSection) promptSection = toolPromptSection;
    persisted = persisted || toolOutcome?.persisted === true;
    toolAffinityUpdateCount = Array.isArray(toolOutcome?.toolUpdates) ? toolOutcome.toolUpdates.length : 0;
    if (!disabledReason) {
      disabledReason = normalizeText(toolOutcome?.disabledReason || "");
    }
  }

  return {
    promptSection,
    snapshotPath,
    applied: appliedSignalCount > 0 || toolAffinityUpdateCount > 0,
    persisted,
    appliedSignalCount,
    rejectedSignalCount,
    toolAffinityUpdateCount,
    disabledReason,
  };
}

export async function loadAgentIdentityPrompt(params: {
  userContextId: string;
  personaWorkspaceDir: string;
  maxPromptTokens?: number;
}): Promise<string> {
  const userContextId = normalizeUserContextId(String(params.userContextId || ""));
  const personaWorkspaceDir = String(params.personaWorkspaceDir || "").trim();
  if (!userContextId || !personaWorkspaceDir) return "";
  const runtimeEngine = await loadRuntimeIdentityEngine();
  const outcome = runtimeEngine.loadIdentityIntelligenceSnapshot({
    userContextId,
    workspaceDir: personaWorkspaceDir,
    maxPromptTokens: clamp(Number(params.maxPromptTokens || 220), 80, 800),
  });
  return normalizeText(outcome?.promptSection || "");
}
