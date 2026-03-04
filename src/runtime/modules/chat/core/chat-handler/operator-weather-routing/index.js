import { TOOL_LOOP_ENABLED } from "../../../../../core/constants/index.js";
import { toolRuntime } from "../../../../infrastructure/config/index.js";
import {
  clearPendingWeatherConfirm,
  getPendingWeatherConfirm,
  isWeatherConfirmNo,
  isWeatherConfirmYes,
  tryWeatherFastPathReply,
} from "../../../fast-path/weather-fast-path/index.js";

export async function handleWeatherConfirmationRouting(input = {}) {
  const {
    text,
    sessionKey,
    userContextId,
    ctx,
    sendDirectAssistantReply,
  } = input;

  const pendingWeather = getPendingWeatherConfirm(sessionKey);
  if (!pendingWeather) return null;

  if (isWeatherConfirmNo(text)) {
    clearPendingWeatherConfirm(sessionKey);
    const reply = await sendDirectAssistantReply(
      text,
      "Okay. I will not run that location. Share the correct city and I will fetch weather immediately.",
      ctx,
      "Waiting for location",
    );
    return {
      route: "weather_confirm_declined",
      ok: true,
      reply,
    };
  }

  if (isWeatherConfirmYes(text)) {
    const runtimeTools = await toolRuntime.initToolRuntimeIfNeeded({ userContextId });
    const availableTools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
    const canRunToolLoop = TOOL_LOOP_ENABLED
      && availableTools.length > 0
      && typeof runtimeTools?.executeToolUse === "function";
    const canRunWebSearch = canRunToolLoop && availableTools.some((t) => String(t?.name || "") === "web_search");
    clearPendingWeatherConfirm(sessionKey);
    const confirmedWeatherResult = await tryWeatherFastPathReply({
      text: pendingWeather.prompt,
      runtimeTools,
      availableTools,
      canRunWebSearch,
      forcedLocation: pendingWeather.suggestedLocation,
      bypassConfirmation: true,
    });
    const confirmedReply = String(confirmedWeatherResult?.reply || "").trim()
      || `I could not fetch weather for ${pendingWeather.suggestedLocation} yet. Please retry.`;
    const reply = await sendDirectAssistantReply(text, confirmedReply, ctx, "Fetching weather");
    return {
      route: "weather_confirm_accepted",
      ok: true,
      reply,
      toolCalls: confirmedWeatherResult?.toolCall ? [String(confirmedWeatherResult.toolCall)] : [],
      canRunToolLoop,
      canRunWebSearch,
    };
  }

  // If the user moved on or asked a fresh weather question, do not trap the
  // session in a yes/no loop. Clear stale confirmation and continue routing.
  clearPendingWeatherConfirm(sessionKey);
  return null;
}

