import { VOICE_MAP } from "../../../../compat/voice/index.js";
import { createTtsProviderAdapter } from "./provider-adapter/index.js";

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function buildTtsSummary({
  ok = true,
  reply = "",
  error = "",
  code = "",
  requestHints = {},
  telemetry = {},
}) {
  return {
    ok,
    route: "tts",
    responseRoute: "tts",
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

function resolveKnownVoice(text = "") {
  const normalized = String(text || "").toLowerCase();
  return Object.keys(VOICE_MAP).find((voiceId) => new RegExp(`\\b${voiceId}\\b`, "i").test(normalized)) || "";
}

function parseTtsCommand(text = "") {
  const normalized = String(text || "").trim();
  const lowered = normalized.toLowerCase();
  if (!lowered) return { kind: "unknown" };
  if (/\b(stop|quiet|silence|cancel)\b/.test(lowered) && /\b(read|speak|tts|voice)\b/.test(lowered)) {
    return { kind: "stop" };
  }
  if (/\b(status|state|settings?)\b/.test(lowered) && /\b(tts|voice|read)\b/.test(lowered)) {
    return { kind: "status" };
  }
  const voiceId = resolveKnownVoice(lowered);
  if (voiceId && /\b(tts|voice)\b/.test(lowered) && /\b(set|use|switch|change)\b/.test(lowered)) {
    return { kind: "set_voice", ttsVoice: voiceId };
  }
  const readMatch = normalized.match(/\b(?:read|speak)\s+(?:this\s+aloud\s*:?|aloud\s*:?|out\s+loud\s*:?)\s*(.+)$/i);
  if (readMatch?.[1]) {
    return {
      kind: "read_aloud",
      text: normalizeText(readMatch[1]),
      ttsVoice: voiceId,
    };
  }
  return { kind: "unknown" };
}

export async function runTtsDomainService(input = {}, deps = {}) {
  const startedAt = Date.now();
  const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
  const userContextId = normalizeText(input.userContextId || ctx.userContextId);
  const conversationId = normalizeText(input.conversationId || ctx.conversationId);
  const sessionKey = normalizeText(input.sessionKey || ctx.sessionKey);
  const requestHints = input.requestHints && typeof input.requestHints === "object" ? input.requestHints : {};
  const providerAdapter = deps.providerAdapter && typeof deps.providerAdapter === "object"
    ? deps.providerAdapter
    : createTtsProviderAdapter({
      ...deps,
      getActiveUserContextId: () => userContextId,
    });
  const parsedCommand = parseTtsCommand(input.text);

  if (parsedCommand.kind !== "unknown") {
    if (!userContextId || !conversationId || !sessionKey) {
      return buildTtsSummary({
        ok: false,
        reply: "I couldn't update TTS settings right now. Please retry.",
        error: "tts.context_missing",
        code: "tts.context_missing",
        requestHints,
        telemetry: {
          domain: "tts",
          adapterId: providerAdapter.id,
          latencyMs: Date.now() - startedAt,
          userContextId,
          conversationId,
          sessionKey,
        },
      });
    }

    let state = providerAdapter.getScopedState(userContextId);
    let reply = `TTS voice is ${state.ttsVoice}.`;

    if (parsedCommand.kind === "set_voice") {
      state = providerAdapter.updateVoiceState({
        userContextId,
        patch: { ttsVoice: parsedCommand.ttsVoice },
        syncRuntime: true,
        broadcastRuntimeState: false,
      });
      reply = `TTS voice set to ${state.ttsVoice}.`;
    } else if (parsedCommand.kind === "read_aloud") {
      if (!parsedCommand.text) {
        reply = "Tell me what to read aloud after the TTS command.";
      } else {
        state = await providerAdapter.speakText({
          userContextId,
          text: parsedCommand.text,
          ttsVoice: parsedCommand.ttsVoice || state.ttsVoice,
        });
        reply = `Reading aloud with the ${state.ttsVoice} voice.`;
      }
    } else if (parsedCommand.kind === "stop") {
      providerAdapter.stopSpeaking({ userContextId });
      reply = "Stopped TTS playback for this user.";
    } else {
      reply = `TTS status: voice ${state.ttsVoice}, voice replies ${state.voiceEnabled ? "enabled" : "disabled"}, input ${state.muted ? "muted" : "listening"}.`;
    }

    return buildTtsSummary({
      ok: true,
      reply,
      requestHints,
      telemetry: {
        domain: "tts",
        adapterId: providerAdapter.id,
        latencyMs: Date.now() - startedAt,
        userContextId,
        conversationId,
        sessionKey,
        ttsVoice: state.ttsVoice,
      },
    });
  }

  return buildTtsSummary({
    ok: true,
    reply: "TTS can report status, change the TTS voice, stop playback, or read text aloud.",
    code: "tts.unsupported_command",
    requestHints,
    telemetry: {
      domain: "tts",
      adapterId: providerAdapter.id,
      latencyMs: Date.now() - startedAt,
      userContextId,
      conversationId,
      sessionKey,
    },
  });
}
