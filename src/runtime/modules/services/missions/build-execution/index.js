import {
  buildMissionBuildResponseBase,
  normalizeMissionBuildInput,
} from "../build-service/index.js";
import { validateMissionGraphForVersioning } from "../graph-validation/index.js";
import { resolveTimezone } from "../../shared/timezone/index.js";

function buildResult(statusCode, body, headers = {}) {
  return {
    statusCode,
    body,
    headers,
  };
}

function requireFunction(dependencies, key) {
  const candidate = dependencies?.[key];
  if (typeof candidate !== "function") {
    throw new Error(`Mission build service dependency "${key}" is required.`);
  }
  return candidate;
}

async function emitMissionTelemetry(dependencies, payload) {
  const emitTelemetry = requireFunction(dependencies, "emitTelemetry");
  await emitTelemetry(payload).catch(() => {});
}

export async function runMissionBuildRequest(input = {}, dependencies = {}) {
  const ensureMissionSchedulerStarted = requireFunction(dependencies, "ensureMissionSchedulerStarted");
  const reserveMissionBuildRequest = requireFunction(dependencies, "reserveMissionBuildRequest");
  const finalizeMissionBuildRequest = requireFunction(dependencies, "finalizeMissionBuildRequest");
  const buildMissionFromPrompt = requireFunction(dependencies, "buildMissionFromPrompt");
  const upsertMission = requireFunction(dependencies, "upsertMission");
  const syncMissionScheduleToGoogleCalendar = requireFunction(dependencies, "syncMissionScheduleToGoogleCalendar");
  const warn = requireFunction(dependencies, "warn");

  const userContextId = String(input.userContextId || "").trim();
  if (!userContextId) throw new Error("Mission build requires userContextId.");

  ensureMissionSchedulerStarted();
  const startedAtMs = Date.now();
  let debugSelected = "server_llm=unknown model=unknown";
  let reservationKey = "";

  const normalizedInput = normalizeMissionBuildInput({
    prompt: input.prompt,
    deploy: input.deploy,
    timezone: input.timezone,
    enabled: input.enabled,
    engine: input.engine,
    userContextId,
  });
  const prompt = normalizedInput.prompt;
  if (!prompt) {
    return buildResult(400, { ok: false, error: "Prompt is required." });
  }
  if (prompt.length > 5000) {
    return buildResult(400, { ok: false, error: "Prompt exceeds 5000 characters." });
  }

  await emitMissionTelemetry(dependencies, {
    eventType: "mission.build.started",
    status: "info",
    userContextId,
    metadata: {
      deploy: normalizedInput.deploy,
    },
  });

  try {
    const deploy = normalizedInput.deploy;
    const timezoneOverride = normalizedInput.timezone || null;
    const reservation = await reserveMissionBuildRequest({
      userContextId,
      prompt,
      deploy,
      timezone: timezoneOverride || "",
      enabled: normalizedInput.enabled,
    });
    reservationKey = String(reservation?.key || "");

    if (reservation?.status === "pending") {
      const retryAfterMs = Math.max(250, Number(reservation.retryAfterMs || 1000));
      return buildResult(
        202,
        {
          ok: true,
          pending: true,
          code: "MISSION_BUILD_PENDING",
          message: "Mission build already in progress.",
          idempotencyKey: reservation.key,
          retryAfterMs,
        },
        {
          "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
        },
      );
    }

    if (reservation?.status === "completed") {
      return buildResult(200, {
        ...(reservation.result || {}),
        ok: true,
        pending: false,
        idempotencyKey: reservation.key,
      });
    }

    if (reservation?.status === "failed") {
      return buildResult(500, {
        ok: false,
        error: reservation.error || "Mission build previously failed.",
        idempotencyKey: reservation.key,
      });
    }

    const generated = await buildMissionFromPrompt(prompt, {
      userId: userContextId,
      scope: input.scope,
    });
    debugSelected = `server_llm=${generated.provider} model=${generated.model}`;

    const mission = generated.mission;
    const triggerNode = Array.isArray(mission?.nodes)
      ? mission.nodes.find((node) => node?.type === "schedule-trigger")
      : null;
    const scheduleTime = String(triggerNode?.triggerTime || "09:00").trim() || "09:00";
    const scheduleTimezone = resolveTimezone(
      timezoneOverride,
      triggerNode?.triggerTimezone,
      mission?.settings?.timezone,
    );

    const responseBase = buildMissionBuildResponseBase({
      mission,
      provider: generated.provider,
      model: generated.model,
      debug: debugSelected,
      scheduleTime,
      scheduleTimezone,
    });

    if (!String(mission?.label || "").trim()) {
      return buildResult(500, { ok: false, error: "Generated mission is missing a label." });
    }

    const graphIssues = validateMissionGraphForVersioning(mission);
    if (Array.isArray(graphIssues) && graphIssues.length > 0) {
      return buildResult(422, {
        ok: false,
        error: "Generated mission graph failed validation.",
        validation: { blocked: true, issues: graphIssues },
      });
    }

    if (!deploy) {
      const payload = {
        ...responseBase,
        deployed: false,
        mission,
        idempotencyKey: reservation.key,
      };
      await finalizeMissionBuildRequest({
        key: reservation.key,
        userContextId,
        ok: true,
        result: payload,
      });
      await emitMissionTelemetry(dependencies, {
        eventType: "mission.build.completed",
        status: "success",
        userContextId,
        durationMs: Date.now() - startedAtMs,
        metadata: { deployed: false },
      });
      return buildResult(200, payload);
    }

    await emitMissionTelemetry(dependencies, {
      eventType: "mission.validation.completed",
      status: "success",
      userContextId,
      metadata: { stage: "save", blocked: false, issueCount: 0 },
    });

    const deployedMission = {
      ...mission,
      status: "active",
      settings: {
        ...mission.settings,
        timezone: scheduleTimezone,
      },
    };
    await upsertMission(deployedMission, userContextId);
    await syncMissionScheduleToGoogleCalendar({
      mission: deployedMission,
      scope: input.scope,
    }).catch((error) => {
      warn(
        "[missions.build][gcalendar_sync] schedule mirror failed:",
        error instanceof Error ? error.message : String(error),
      );
    });

    const payload = {
      ...responseBase,
      deployed: true,
      mission: deployedMission,
      idempotencyKey: reservation.key,
    };
    await finalizeMissionBuildRequest({
      key: reservation.key,
      userContextId,
      ok: true,
      result: payload,
    });
    await emitMissionTelemetry(dependencies, {
      eventType: "mission.build.completed",
      status: "success",
      userContextId,
      missionId: mission.id,
      durationMs: Date.now() - startedAtMs,
      metadata: { deployed: true },
    });
    return buildResult(201, payload);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to build workflow.";
    const isContractFailure =
      /invalid node payload/i.test(errorMessage)
      || /required an agent graph/i.test(errorMessage)
      || /invalid graph contract/i.test(errorMessage)
      || /graph failed validation/i.test(errorMessage);
    const statusCode = isContractFailure ? 422 : 500;

    if (reservationKey) {
      await finalizeMissionBuildRequest({
        key: reservationKey,
        userContextId,
        ok: false,
        error: errorMessage,
      });
    }

    await emitMissionTelemetry(dependencies, {
      eventType: "mission.build.failed",
      status: "error",
      userContextId,
      durationMs: Date.now() - startedAtMs,
      metadata: {
        error: errorMessage,
        contractFailure: isContractFailure,
      },
    });

    return buildResult(statusCode, {
      ok: false,
      error: errorMessage,
      debug: debugSelected,
      validation: isContractFailure ? { blocked: true, stage: "generation-contract" } : undefined,
    });
  }
}
