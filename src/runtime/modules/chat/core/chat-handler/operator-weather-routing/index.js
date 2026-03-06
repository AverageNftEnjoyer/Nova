import {
  clearPendingWeatherConfirmation,
  isWeatherConfirmationAccepted,
  isWeatherConfirmationRejected,
  readPendingWeatherConfirmation,
  runWeatherLookup,
} from "../../../workers/market/weather-service/index.js";

export async function handleWeatherConfirmationRouting(input = {}) {
  const {
    text,
    sessionKey,
    userContextId,
    conversationId,
    ctx,
    sendDirectAssistantReply,
    runWeatherLookup: runWeatherLookupOverride = null,
  } = input;

  const pendingWeather = readPendingWeatherConfirmation({ userContextId, conversationId });
  if (!pendingWeather) return null;

  if (isWeatherConfirmationRejected(text)) {
    clearPendingWeatherConfirmation({ userContextId, conversationId });
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

  if (isWeatherConfirmationAccepted(text)) {
    const runWeatherLookupRef = typeof runWeatherLookupOverride === "function"
      ? runWeatherLookupOverride
      : runWeatherLookup;
    clearPendingWeatherConfirmation({ userContextId, conversationId });
    const confirmedWeatherResult = await runWeatherLookupRef({
      text: pendingWeather.prompt,
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
    };
  }

  // If the user moved on or asked a fresh weather question, do not trap the
  // session in a yes/no loop. Clear stale confirmation and continue routing.
  clearPendingWeatherConfirmation({ userContextId, conversationId });
  return null;
}
