import { loadIntegrationsRuntime } from "../../../providers/runtime/index.js";
import type { Tool } from "../../core/types/index.js";

const PHANTOM_TOOL_NAMES = new Set(["phantom_capabilities"]);

function toJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      ok: false,
      kind: "phantom_error",
      source: "phantom",
      errorCode: "SERIALIZE_FAILED",
      message: "Failed to serialize Phantom output.",
      safeMessage: "I couldn't inspect Phantom wallet status right now.",
      guidance: "Retry in a moment.",
      retryable: true,
    });
  }
}

function normalizeUserContextId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function toString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function isPhantomToolName(name: unknown): boolean {
  return PHANTOM_TOOL_NAMES.has(String(name || "").trim());
}

export function createPhantomTools(params: { workspaceDir: string }): Tool[] {
  const capabilities: Tool = {
    name: "phantom_capabilities",
    description: "Return Phantom wallet verification status and safe capability flags for this user context.",
    riskLevel: "safe",
    capabilities: ["integration.wallet.read"],
    input_schema: {
      type: "object",
      properties: {
        userContextId: { type: "string" },
        conversationId: { type: "string" },
      },
      required: ["userContextId"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const userContextId = normalizeUserContextId((input || {}).userContextId);
      if (!userContextId) {
        return toJson({
          ok: false,
          kind: "phantom_error",
          source: "phantom",
          errorCode: "BAD_INPUT",
          message: "Missing userContextId.",
          safeMessage: "Wallet context is unavailable because the user context is missing.",
          guidance: "Retry from an authenticated chat.",
          retryable: false,
        });
      }

      const runtime = loadIntegrationsRuntime({
        workspaceRoot: params.workspaceDir,
        userContextId,
      }) as { phantom?: unknown };
      const phantom = toRecord(runtime.phantom);
      const preferences = toRecord(phantom.preferences);
      const capabilityFlags = toRecord(phantom.capabilities);

      return toJson({
        ok: true,
        kind: "phantom_capabilities",
        source: "phantom",
        data: {
          connected: phantom.connected === true,
          provider: "phantom",
          chain: "solana",
          walletAddress: toString(phantom.walletAddress),
          walletLabel: toString(phantom.walletLabel),
          connectedAt: toString(phantom.connectedAt),
          verifiedAt: toString(phantom.verifiedAt),
          lastDisconnectedAt: toString(phantom.lastDisconnectedAt),
          evmAddress: toString(phantom.evmAddress),
          evmLabel: toString(phantom.evmLabel),
          evmChainId: toString(phantom.evmChainId),
          evmConnectedAt: toString(phantom.evmConnectedAt),
          preferences: {
            allowAgentWalletContext: preferences.allowAgentWalletContext !== false,
            allowAgentEvmContext: preferences.allowAgentEvmContext !== false,
            allowApprovalGatedPolymarket: preferences.allowApprovalGatedPolymarket !== false,
          },
          capabilities: {
            signMessage: capabilityFlags.signMessage !== false,
            walletOwnershipProof: capabilityFlags.walletOwnershipProof !== false,
            solanaConnected: capabilityFlags.solanaConnected === true,
            solanaVerified: capabilityFlags.solanaVerified === true,
            evmAvailable: capabilityFlags.evmAvailable === true,
            approvalGatedPolymarket: capabilityFlags.approvalGatedPolymarket !== false,
            approvalGatedPolymarketReady: capabilityFlags.approvalGatedPolymarketReady === true,
            autonomousTrading: capabilityFlags.autonomousTrading === true,
          },
        },
        checkedAtMs: Date.now(),
      });
    },
  };

  return [capabilities];
}
