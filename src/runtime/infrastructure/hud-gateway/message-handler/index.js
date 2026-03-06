export async function handleHudGatewayMessage({
  ws,
  raw,
  connectionRateState,
  deps = {},
} = {}) {
  const {
    checkWindowRateLimit,
    WS_CONN_RATE_MAX,
    WS_CONN_RATE_WINDOW_MS,
    ensureSocketUserContextBinding,
    stopSpeaking,
    getSystemMetrics,
    hudRequestScheduler,
    CALENDAR_EMIT_EVENT_TYPES,
    sanitizeCalendarEventId,
    sanitizeCalendarPatch,
    sanitizeCalendarConflicts,
    broadcastCalendarEventUpdated,
    broadcastCalendarRescheduled,
    broadcastCalendarConflict,
    VOICE_MAP,
    getCurrentVoice,
    getVoiceEnabled,
    getBusy,
    setBusy,
    speak,
    broadcastState,
    normalizeUserContextId,
    wsContextBySocket,
    checkWsUserRateLimit,
    sessionRuntime,
    sendHudStreamError,
    trackConversationOwner,
    normalizeHudOpToken,
    reserveHudOpToken,
    sendHudMessageAck,
    classifyHudRequestLane,
    broadcastThinkingStatus,
    HUD_MIN_THINKING_PRESENCE_MS,
    markHudOpTokenAccepted,
    grantPolicyApproval,
    markHudWorkStart,
    markHudWorkEnd,
    handleInput,
    releaseHudOpTokenReservation,
    toErrorDetails,
    getMuted,
    setSuppressVoiceWakeUntilMs,
    broadcast,
    describeUnknownError,
    voiceProviderAdapter,
  } = deps;

  try {
    const connRate = checkWindowRateLimit(
      connectionRateState,
      Date.now(),
      WS_CONN_RATE_MAX,
      WS_CONN_RATE_WINDOW_MS,
    );
    if (!connRate.allowed) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "rate_limited",
          scope: "connection",
          retryAfterMs: connRate.retryAfterMs,
          message: "Too many websocket messages. Please slow down.",
          ts: Date.now(),
        }));
      }
      return;
    }

    const data = JSON.parse(raw.toString());
    if (data.type === "interrupt") {
      const interruptBind = await ensureSocketUserContextBinding(ws, {
        requestedUserContextId: typeof data.userId === "string" ? data.userId : "",
        supabaseAccessToken: typeof data.supabaseAccessToken === "string" ? data.supabaseAccessToken : "",
      });
      if (!interruptBind.ok) return;
      console.log("[HUD] Interrupt received.");
      stopSpeaking({ userContextId: interruptBind.userContextId });
      return;
    }

    if (data.type === "request_system_metrics") {
      const metrics = await getSystemMetrics();
      if (metrics && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "system_metrics",
          metrics,
          scheduler: hudRequestScheduler.getSnapshot(),
          ts: Date.now(),
        }));
      }
      return;
    }

    if (data.type === "calendar_emit") {
      const requestedUserContextId = typeof data.userId === "string" ? data.userId : "";
      const emitBind = await ensureSocketUserContextBinding(ws, {
        requestedUserContextId,
        supabaseAccessToken: typeof data.supabaseAccessToken === "string" ? data.supabaseAccessToken : "",
      });
      if (!emitBind.ok) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "auth_error",
            code: emitBind.code,
            message: emitBind.message,
            ts: Date.now(),
          }));
        }
        return;
      }

      const eventType = String(data.eventType || "").trim().toLowerCase();
      if (!CALENDAR_EMIT_EVENT_TYPES.has(eventType)) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "calendar_emit_ack",
            ok: false,
            error: "unsupported_event_type",
            eventType,
            userContextId: emitBind.userContextId,
            ts: Date.now(),
          }));
        }
        return;
      }

      if (eventType === "calendar:event:updated") {
        const eventId = sanitizeCalendarEventId(data.eventId);
        if (!eventId) return;
        broadcastCalendarEventUpdated({
          userContextId: emitBind.userContextId,
          eventId,
          patch: sanitizeCalendarPatch(data.patch),
        });
      } else if (eventType === "calendar:rescheduled") {
        const missionId = sanitizeCalendarEventId(data.missionId);
        const newStartAt = typeof data.newStartAt === "string" ? String(data.newStartAt).trim() : "";
        if (!missionId || !newStartAt) return;
        broadcastCalendarRescheduled({
          userContextId: emitBind.userContextId,
          missionId,
          newStartAt,
          conflict: data.conflict === true,
        });
      } else if (eventType === "calendar:conflict") {
        broadcastCalendarConflict({
          userContextId: emitBind.userContextId,
          conflicts: sanitizeCalendarConflicts(data.conflicts),
        });
      }

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "calendar_emit_ack",
          ok: true,
          eventType,
          userContextId: emitBind.userContextId,
          ts: Date.now(),
        }));
      }
      return;
    }

    if (data.type === "greeting") {
      const greetingBind = await ensureSocketUserContextBinding(ws, {
        requestedUserContextId: typeof data.userId === "string" ? data.userId : "",
        supabaseAccessToken: typeof data.supabaseAccessToken === "string" ? data.supabaseAccessToken : "",
      });
      if (!greetingBind.ok) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "auth_error",
            code: greetingBind.code,
            message: greetingBind.message,
            ts: Date.now(),
          }));
        }
        return;
      }
      console.log("[HUD] Greeting requested. voiceEnabled:", data.voiceEnabled);
      const scopedUserContextId = normalizeUserContextId(wsContextBySocket.get(ws) || "");
      voiceProviderAdapter.updateUserState({
        userContextId: scopedUserContextId,
        patch: {
          ...(typeof data.assistantName === "string" ? { assistantName: data.assistantName } : null),
          ...(data.ttsVoice && VOICE_MAP[data.ttsVoice] ? { ttsVoice: data.ttsVoice } : null),
          ...(typeof data.voiceEnabled === "boolean" ? { voiceEnabled: data.voiceEnabled } : null),
        },
        syncRuntime: true,
        broadcastRuntimeState: false,
      });
      if (data.voiceEnabled === false || getVoiceEnabled({ userContextId: scopedUserContextId }) === false) return;
      if (!getBusy({ userContextId: scopedUserContextId })) {
        setBusy(true, { userContextId: scopedUserContextId });
        try {
          const greetingText = data.text || "Hello! What are we working on today?";
          broadcastState("speaking", scopedUserContextId);
          await speak(
            greetingText,
            getCurrentVoice({ userContextId: scopedUserContextId }),
            { userContextId: scopedUserContextId },
          );
          broadcastState("idle", scopedUserContextId);
        } finally {
          setBusy(false, { userContextId: scopedUserContextId });
        }
      }
      return;
    }

    if (data.type === "hud_message" && data.content) {
      const userRate = checkWsUserRateLimit(typeof data.userId === "string" ? data.userId : "");
      if (!userRate.allowed) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "rate_limited",
            scope: "user",
            retryAfterMs: userRate.retryAfterMs,
            message: "Too many messages from this user. Please slow down.",
            ts: Date.now(),
          }));
        }
        return;
      }

      const conversationId = typeof data.conversationId === "string" ? data.conversationId.trim() : "";
      const incomingUserId = sessionRuntime.normalizeUserContextId(
        typeof data.userId === "string" ? data.userId : "",
      );
      const bindDecision = await ensureSocketUserContextBinding(ws, {
        requestedUserContextId: incomingUserId,
        supabaseAccessToken: typeof data.supabaseAccessToken === "string" ? data.supabaseAccessToken : "",
      });
      if (!bindDecision.ok) {
        sendHudStreamError(
          conversationId,
          bindDecision.message || "Request blocked: websocket authentication failed.",
          ws,
          0,
          incomingUserId,
        );
        broadcastState("idle", incomingUserId);
        return;
      }
      const redactedLen = String(data.content || "").length;
      console.log("[HUD ->] chars:", redactedLen, "| voice:", data.voice, "| ttsVoice:", data.ttsVoice);
      if (data.voice !== false) stopSpeaking({ userContextId: incomingUserId });

      if (!incomingUserId) {
        sendHudStreamError(
          conversationId,
          "Request blocked: missing user identity. Please sign in again and retry.",
          ws,
          0,
          incomingUserId,
        );
        broadcastState("idle", incomingUserId);
        return;
      }
      if (!conversationId) {
        sendHudStreamError(
          "",
          "Request blocked: missing conversation context. Open a chat thread and retry.",
          ws,
          0,
          incomingUserId,
        );
        broadcastState("idle", incomingUserId);
        return;
      }
      if (data.ttsVoice && VOICE_MAP[data.ttsVoice]) {
        voiceProviderAdapter.updateUserState({
          userContextId: incomingUserId,
          patch: { ttsVoice: data.ttsVoice },
          syncRuntime: true,
          broadcastRuntimeState: false,
        });
        console.log("[Voice] Preference updated to:", getCurrentVoice({ userContextId: incomingUserId }));
      }
      if (typeof data.assistantName === "string" && data.assistantName.trim()) {
        voiceProviderAdapter.updateUserState({
          userContextId: incomingUserId,
          patch: { assistantName: data.assistantName },
          syncRuntime: true,
          broadcastRuntimeState: false,
        });
      }
      trackConversationOwner(conversationId, incomingUserId);

      const opToken = normalizeHudOpToken(typeof data.opToken === "string" ? data.opToken : "");
      let reservedOpTokenKey = "";
      let opTokenAccepted = false;
      if (opToken) {
        const reservation = reserveHudOpToken(incomingUserId, opToken, conversationId);
        if (reservation.status === "conflict") {
          sendHudStreamError(
            conversationId,
            "Request token conflict detected for a different conversation. Please retry from the active chat thread.",
            ws,
            0,
            incomingUserId,
          );
          return;
        }
        if (reservation.status === "duplicate_accepted") {
          sendHudMessageAck(ws, {
            opToken,
            conversationId: reservation.conversationId || conversationId,
            userContextId: incomingUserId,
            duplicate: true,
          });
          return;
        }
        if (reservation.status === "duplicate_pending") {
          return;
        }
        if (reservation.status === "reserved") {
          reservedOpTokenKey = reservation.key;
        }
      }

      try {
        const lane = classifyHudRequestLane(data.content);
        const sessionKeyHint = typeof data.sessionKey === "string" && data.sessionKey.trim()
          ? data.sessionKey
          : `agent:nova:hud:user:${incomingUserId}:dm:${conversationId}`;
        broadcastState("thinking", incomingUserId);
        broadcastThinkingStatus("Analyzing request", incomingUserId);
        const thinkingShownAt = Date.now();
        await hudRequestScheduler.enqueue({
          lane,
          userId: incomingUserId,
          conversationId: conversationId || "",
          supersedeKey: conversationId || "",
          run: async () => {
            const shownForMs = Date.now() - thinkingShownAt;
            if (shownForMs < HUD_MIN_THINKING_PRESENCE_MS) {
              await new Promise((resolve) => setTimeout(resolve, HUD_MIN_THINKING_PRESENCE_MS - shownForMs));
            }
            if (opToken && reservedOpTokenKey && !opTokenAccepted) {
              markHudOpTokenAccepted(reservedOpTokenKey, conversationId);
              opTokenAccepted = true;
              if (typeof grantPolicyApproval === "function") {
                grantPolicyApproval({
                  userContextId: incomingUserId,
                  conversationId,
                  sessionKey: sessionKeyHint,
                  source: "hud_op_token",
                });
              }
              sendHudMessageAck(ws, {
                opToken,
                conversationId,
                userContextId: incomingUserId,
                duplicate: false,
              });
            }
            markHudWorkStart(incomingUserId);
            try {
              await handleInput(data.content, {
                voice: data.voice !== false,
                ttsVoice: data.ttsVoice || getCurrentVoice({ userContextId: incomingUserId }),
                source: "hud",
                sender: typeof data.sender === "string" ? data.sender : "hud-user",
                inboundMessageId:
                  typeof data.messageId === "string"
                    ? data.messageId
                    : typeof data.clientMessageId === "string"
                      ? data.clientMessageId
                      : "",
                userContextId: incomingUserId || undefined,
                supabaseAccessToken:
                  typeof data.supabaseAccessToken === "string"
                    ? data.supabaseAccessToken
                    : "",
                assistantName: typeof data.assistantName === "string" ? data.assistantName : "",
                communicationStyle: typeof data.communicationStyle === "string" ? data.communicationStyle : "",
                tone: typeof data.tone === "string" ? data.tone : "",
                customInstructions: typeof data.customInstructions === "string" ? data.customInstructions : "",
                nlpBypass: data.nlpBypass === true,
                conversationId: conversationId || undefined,
                hudOpToken: opToken || "",
                sessionKeyHint,
              });
            } finally {
              markHudWorkEnd(incomingUserId);
            }
          },
        });
      } catch (err) {
        if (reservedOpTokenKey && !opTokenAccepted) {
          releaseHudOpTokenReservation(reservedOpTokenKey);
        }
        const details = toErrorDetails(err);
        const code = String(err?.code || details.code || "").trim().toLowerCase();
        const retryAfterMs = Number(err?.retryAfterMs || 0);
        const msg = details.message || "Unexpected runtime failure.";
        if (code === "superseded") {
          sendHudStreamError(
            conversationId,
            "Cancelled previous queued request because a newer message arrived in this chat.",
            ws,
            0,
            incomingUserId,
          );
          broadcastState("idle", incomingUserId);
          return;
        }
        if (code === "queue_full" || code === "queue_stale") {
          sendHudStreamError(
            conversationId,
            code === "queue_stale"
              ? "Queued request expired before execution. Please retry."
              : `Nova is busy right now. Please retry in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`,
            ws,
            retryAfterMs,
            incomingUserId,
          );
          broadcastState("idle", incomingUserId);
          return;
        }
        console.error(
          `[HUD] handleInput failed status=${details.status ?? "n/a"} code=${details.code ?? "n/a"} type=${details.type ?? "n/a"} message=${msg}`,
        );
        sendHudStreamError(
          conversationId,
          `Request failed${details.status ? ` (${details.status})` : ""}${details.code ? ` [${details.code}]` : ""}: ${msg}`,
          ws,
          0,
          incomingUserId,
        );
        broadcastState("idle", incomingUserId);
      }
    }

    if (data.type === "set_voice") {
      const voiceBind = await ensureSocketUserContextBinding(ws, {
        requestedUserContextId: typeof data.userId === "string" ? data.userId : "",
        supabaseAccessToken: typeof data.supabaseAccessToken === "string" ? data.supabaseAccessToken : "",
      });
      if (!voiceBind.ok) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "auth_error",
            code: voiceBind.code,
            message: voiceBind.message,
            ts: Date.now(),
          }));
        }
        return;
      }
      const scopedUserContextId = normalizeUserContextId(wsContextBySocket.get(ws) || "");
      const nextVoiceState = voiceProviderAdapter.updateUserState({
        userContextId: scopedUserContextId,
        patch: {
          ...(typeof data.assistantName === "string" ? { assistantName: data.assistantName } : null),
          ...(data.ttsVoice && VOICE_MAP[data.ttsVoice] ? { ttsVoice: data.ttsVoice } : null),
          ...(typeof data.voiceEnabled === "boolean" ? { voiceEnabled: data.voiceEnabled } : null),
        },
        syncRuntime: true,
        broadcastRuntimeState: false,
      });
      console.log("[Voice] TTS voice set to:", nextVoiceState.ttsVoice);
      console.log("[Voice] Voice responses enabled:", nextVoiceState.voiceEnabled);
    }

    if (data.type === "set_mute") {
      const muteBind = await ensureSocketUserContextBinding(ws, {
        requestedUserContextId: typeof data.userId === "string" ? data.userId : "",
        supabaseAccessToken: typeof data.supabaseAccessToken === "string" ? data.supabaseAccessToken : "",
      });
      if (!muteBind.ok) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "auth_error",
            code: muteBind.code,
            message: muteBind.message,
            ts: Date.now(),
          }));
        }
        return;
      }
      const scopedUserContextId = normalizeUserContextId(wsContextBySocket.get(ws) || "");
      const nextVoiceState = voiceProviderAdapter.updateUserState({
        userContextId: scopedUserContextId,
        patch: {
          muted: data.muted === true,
          ...(typeof data.assistantName === "string" ? { assistantName: data.assistantName } : null),
        },
        syncRuntime: true,
        broadcastRuntimeState: true,
      });
      console.log("[Nova] Muted:", nextVoiceState.muted);
      if (!getMuted({ userContextId: scopedUserContextId })) {
        const UNMUTE_SUPPRESS_MS = 1200;
        setSuppressVoiceWakeUntilMs(Date.now() + UNMUTE_SUPPRESS_MS, { userContextId: scopedUserContextId });
        broadcast(
          {
            type: "transcript",
            text: "",
            ...(scopedUserContextId ? { userContextId: scopedUserContextId } : {}),
            ts: Date.now(),
          },
          { userContextId: scopedUserContextId },
        );
      }
    }
  } catch (e) {
    console.error("[WS] Bad message from HUD:", describeUnknownError(e));
  }
}
