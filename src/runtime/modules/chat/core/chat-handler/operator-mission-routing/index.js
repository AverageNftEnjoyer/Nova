import {
  shouldBuildWorkflowFromPrompt,
  shouldConfirmWorkflowFromPrompt,
} from "../../../routing/intent-router/index.js";
import {
  buildMissionConfirmReply,
  clearPendingMissionConfirm,
  getPendingMissionConfirm,
  isMissionConfirmNo,
  isMissionConfirmYes,
  setPendingMissionConfirm,
  stripAssistantInvocation,
  stripMissionConfirmPrefix,
} from "../../chat-utils/index.js";

const MISSION_FOLLOWUP_DETAIL_PATTERN =
  /\b(at|am|pm|est|et|pst|pt|cst|ct|telegram|discord|telegram|daily|every|morning|night|tomorrow)\b/i;

export function mergeMissionPrompt(basePrompt, incomingText) {
  const base = String(basePrompt || "").replace(/\s+/g, " ").trim();
  const incomingRaw = stripAssistantInvocation(incomingText);
  const incoming = String(incomingRaw || incomingText || "").replace(/\s+/g, " ").trim();
  if (!base) return incoming;
  if (!incoming) return base;
  const baseNorm = base.toLowerCase();
  const incomingNorm = incoming.toLowerCase();
  if (incomingNorm === baseNorm) return base;
  if (baseNorm.includes(incomingNorm)) return base;
  if (incomingNorm.includes(baseNorm)) return incoming;
  return `${base}. ${incoming}`.replace(/\s+/g, " ").trim();
}

export async function handleMissionContextRouting(input = {}) {
  const {
    text,
    normalizedTextForRouting,
    missionContextIsPrimary,
    missionShortTermContext,
    missionPolicy,
    userContextId,
    conversationId,
    sessionKey,
    ctx,
    sendDirectAssistantReply,
    upsertShortTermContextState,
    clearShortTermContextState,
  } = input;

  if (!missionContextIsPrimary || !missionPolicy) return null;

  if (missionPolicy.isCancel(normalizedTextForRouting)) {
    clearPendingMissionConfirm({ userContextId, conversationId });
    clearShortTermContextState({ userContextId, conversationId, domainId: "mission_task" });
    const reply = await sendDirectAssistantReply(
      text,
      "Okay. I canceled the mission follow-up context.",
      ctx,
      "Clearing mission context",
    );
    return {
      route: "mission_context_canceled",
      ok: true,
      reply,
    };
  }

  const missionIsFollowUpRefine =
    missionPolicy.isNonCriticalFollowUp(normalizedTextForRouting)
    && !missionPolicy.isNewTopic(normalizedTextForRouting)
    && !missionPolicy.isCancel(normalizedTextForRouting);
  if (missionIsFollowUpRefine && !getPendingMissionConfirm({ userContextId, conversationId })) {
    const basePrompt = String(missionShortTermContext?.slots?.pendingPrompt || "").trim();
    const mergedPrompt = mergeMissionPrompt(basePrompt, text);
    if (mergedPrompt) {
      setPendingMissionConfirm({ userContextId, conversationId, prompt: mergedPrompt });
      upsertShortTermContextState({
        userContextId,
        conversationId,
        domainId: "mission_task",
        topicAffinityId: "mission_task",
        slots: {
          pendingPrompt: mergedPrompt,
          phase: "confirm_refine",
          lastUserText: String(text || "").trim(),
        },
      });
      const reply = await sendDirectAssistantReply(
        text,
        buildMissionConfirmReply(mergedPrompt),
        ctx,
        "Refining mission",
      );
      return {
        route: "mission_context_refine",
        ok: true,
        reply,
      };
    }
  }
  return null;
}

export async function handleMissionBuildRouting(input = {}) {
  const {
    text,
    userContextId,
    conversationId,
    sessionKey,
    ctx,
    delegateToOrgChartWorker,
    sendDirectAssistantReply,
    missionWorker,
    upsertShortTermContextState,
    clearShortTermContextState,
  } = input;

  const pendingMission = getPendingMissionConfirm({ userContextId, conversationId });
  if (pendingMission) {
    if (isMissionConfirmNo(text)) {
      clearPendingMissionConfirm({ userContextId, conversationId });
      clearShortTermContextState({ userContextId, conversationId, domainId: "mission_task" });
      const reply = await sendDirectAssistantReply(
        text,
        "No problem. I will not create a mission. If you want one later, say: create a mission for ...",
        ctx,
      );
      return {
        route: "mission_confirm_declined",
        ok: true,
        reply,
      };
    }

    if (isMissionConfirmYes(text)) {
      const details = stripMissionConfirmPrefix(text);
      const mergedPrompt = mergeMissionPrompt(pendingMission.prompt, details);
      clearPendingMissionConfirm({ userContextId, conversationId });
      clearShortTermContextState({ userContextId, conversationId, domainId: "mission_task" });
      return await delegateToOrgChartWorker({
        routeHint: "workflow",
        responseRoute: "workflow",
        text: mergedPrompt,
        toolCalls: ["mission"],
        provider: "",
        providerSource: "chat-runtime-fallback",
        userContextId,
        conversationId,
        sessionKey,
        run: async () => missionWorker(mergedPrompt, ctx, { engine: "src" }),
      });
    }

    if (MISSION_FOLLOWUP_DETAIL_PATTERN.test(text)) {
      const mergedPrompt = mergeMissionPrompt(pendingMission.prompt, text);
      setPendingMissionConfirm({ userContextId, conversationId, prompt: mergedPrompt });
      upsertShortTermContextState({
        userContextId,
        conversationId,
        domainId: "mission_task",
        topicAffinityId: "mission_task",
        slots: {
          pendingPrompt: mergedPrompt,
          phase: "confirm_refine",
          lastUserText: String(text || "").trim(),
        },
      });
      const reply = await sendDirectAssistantReply(text, buildMissionConfirmReply(mergedPrompt), ctx);
      return {
        route: "mission_confirm_refine",
        ok: true,
        reply,
      };
    }
  }

  if (shouldBuildWorkflowFromPrompt(text)) {
    clearPendingMissionConfirm({ userContextId, conversationId });
    upsertShortTermContextState({
      userContextId,
      conversationId,
      domainId: "mission_task",
      topicAffinityId: "mission_task",
      slots: {
        pendingPrompt: String(text || "").trim(),
        phase: "build_attempt",
        lastUserText: String(text || "").trim(),
      },
    });
    return await delegateToOrgChartWorker({
      routeHint: "workflow",
      responseRoute: "workflow",
      text,
      toolCalls: ["mission"],
      provider: "",
      providerSource: "chat-runtime-fallback",
      userContextId,
      conversationId,
      sessionKey,
      run: async () => missionWorker(text, ctx, { engine: "src" }),
    });
  }

  if (shouldConfirmWorkflowFromPrompt(text)) {
    const candidatePrompt = stripAssistantInvocation(text) || text;
    setPendingMissionConfirm({ userContextId, conversationId, prompt: candidatePrompt });
    upsertShortTermContextState({
      userContextId,
      conversationId,
      domainId: "mission_task",
      topicAffinityId: "mission_task",
      slots: {
        pendingPrompt: candidatePrompt,
        phase: "confirm_prompt",
        lastUserText: String(text || "").trim(),
      },
    });
    const reply = await sendDirectAssistantReply(text, buildMissionConfirmReply(candidatePrompt), ctx);
    return {
      route: "mission_confirm_prompt",
      ok: true,
      reply,
    };
  }

  return null;
}
