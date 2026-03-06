import { createVoiceProviderAdapter } from "./provider-adapter/index.js";
import { broadcastState } from "../../../infrastructure/hud-gateway/index.js";

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function buildVoiceSummary({
  ok = true,
  route = "voice",
  responseRoute = "voice",
  reply = "",
  error = "",
  code = "",
  requestHints = {},
  telemetry = {},
}) {
  return {
    ok,
    route,
    responseRoute,
    reply,
    error,
    code,
    toolCalls: [],
    toolExecutions: [],
    retries: [],
    requestHints,
    telemetry,
  };
}

function parseVoiceCommand(text = "") {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return { kind: "unknown" };
  if (/\b(status|state|settings?)\b/.test(normalized)) return { kind: "status" };
  if (/\bunmute\b/.test(normalized)) return { kind: "unmute" };
  if (/\bmute\b/.test(normalized)) return { kind: "mute" };
  if (/\b(enable|turn on)\b.*\bvoice\b/.test(normalized)) return { kind: "enable_voice" };
  if (/\b(disable|turn off)\b.*\bvoice\b/.test(normalized)) return { kind: "disable_voice" };
  const assistantNameMatch = normalized.match(/\b(?:call yourself|assistant name is|set assistant name to)\s+(.+)$/i);
  if (assistantNameMatch?.[1]) {
    return {
      kind: "assistant_name",
      assistantName: normalizeText(assistantNameMatch[1]).replace(/[.?!]+$/, ""),
    };
  }
  return { kind: "unknown" };
}

export async function runVoiceDomainService(input = {}, deps = {}) {
  const startedAt = Date.now();
  const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
  const userContextId = normalizeText(input.userContextId || ctx.userContextId);
  const conversationId = normalizeText(input.conversationId || ctx.conversationId);
  const sessionKey = normalizeText(input.sessionKey || ctx.sessionKey);
  const requestHints = input.requestHints && typeof input.requestHints === "object" ? input.requestHints : {};
  const providerAdapter = deps.providerAdapter && typeof deps.providerAdapter === "object"
    ? deps.providerAdapter
    : createVoiceProviderAdapter({
      ...deps,
      broadcastState,
      getActiveUserContextId: () => userContextId,
    });
  const parsedCommand = parseVoiceCommand(input.text);

  if (parsedCommand.kind !== "unknown") {
    if (!userContextId || !conversationId || !sessionKey) {
      return buildVoiceSummary({
        ok: false,
        reply: "I couldn't update voice controls right now. Please retry.",
        error: "voice.context_missing",
        code: "voice.context_missing",
        requestHints,
        telemetry: {
          domain: "voice",
          adapterId: providerAdapter.id,
          latencyMs: Date.now() - startedAt,
          userContextId,
          conversationId,
          sessionKey,
        },
      });
    }
    let state = providerAdapter.getScopedState(userContextId);
    let reply = "Voice settings updated.";
    if (parsedCommand.kind === "mute") {
      state = providerAdapter.updateUserState({
        userContextId,
        patch: { muted: true },
        syncRuntime: true,
        broadcastRuntimeState: true,
      });
      reply = "Voice input is muted for this user.";
    } else if (parsedCommand.kind === "unmute") {
      state = providerAdapter.updateUserState({
        userContextId,
        patch: { muted: false },
        syncRuntime: true,
        broadcastRuntimeState: true,
      });
      reply = "Voice input is unmuted for this user.";
    } else if (parsedCommand.kind === "enable_voice") {
      state = providerAdapter.updateUserState({
        userContextId,
        patch: { voiceEnabled: true },
        syncRuntime: true,
        broadcastRuntimeState: true,
      });
      reply = "Voice responses are enabled for this user.";
    } else if (parsedCommand.kind === "disable_voice") {
      state = providerAdapter.updateUserState({
        userContextId,
        patch: { voiceEnabled: false },
        syncRuntime: true,
        broadcastRuntimeState: true,
      });
      reply = "Voice responses are disabled for this user.";
    } else if (parsedCommand.kind === "assistant_name") {
      state = providerAdapter.updateUserState({
        userContextId,
        patch: { assistantName: parsedCommand.assistantName },
        syncRuntime: true,
        broadcastRuntimeState: false,
      });
      reply = parsedCommand.assistantName
        ? `I'll answer to ${parsedCommand.assistantName}.`
        : "Voice assistant name cleared for this user.";
    } else {
      reply = `Voice status: ${state.muted ? "muted" : "listening"}, voice replies ${state.voiceEnabled ? "enabled" : "disabled"}, TTS voice ${state.ttsVoice}.`;
    }

    return buildVoiceSummary({
      ok: true,
      reply,
      requestHints,
      telemetry: {
        domain: "voice",
        adapterId: providerAdapter.id,
        latencyMs: Date.now() - startedAt,
        userContextId,
        conversationId,
        sessionKey,
        voiceEnabled: state.voiceEnabled === true,
        muted: state.muted === true,
        ttsVoice: state.ttsVoice,
      },
    });
  }

  return buildVoiceSummary({
    ok: true,
    reply: "Voice can mute, unmute, enable or disable voice replies, report status, or set the assistant name.",
    code: "voice.unsupported_command",
    requestHints,
    telemetry: {
      domain: "voice",
      adapterId: providerAdapter.id,
      latencyMs: Date.now() - startedAt,
      userContextId,
      conversationId,
      sessionKey,
    },
  });
}
