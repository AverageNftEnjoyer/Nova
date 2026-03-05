import {
  OPERATOR_LANE_SEQUENCE,
  resolveOperatorLaneKeyPrefix,
} from "../operator-lane-config/index.js";

export function readOperatorLaneShortTermContextSnapshots(input = {}) {
  const {
    userContextId = "",
    conversationId = "",
    readShortTermContextState,
  } = input;

  if (typeof readShortTermContextState !== "function") {
    throw new Error("readOperatorLaneShortTermContextSnapshots requires readShortTermContextState");
  }

  const snapshots = {};
  for (const lane of OPERATOR_LANE_SEQUENCE) {
    const keyPrefix = resolveOperatorLaneKeyPrefix(lane);
    snapshots[`${keyPrefix}ShortTermContextSnapshot`] = readShortTermContextState({
      userContextId,
      conversationId,
      domainId: lane.domainId,
    });
  }
  return snapshots;
}

export function isMissionContextPrimary(input = {}) {
  const {
    missionShortTermContext = null,
    operatorLaneSnapshots = {},
  } = input;

  if (!missionShortTermContext) return false;
  const missionTs = Number(missionShortTermContext.ts || 0);
  return Object.values(operatorLaneSnapshots).every((snapshot) => (
    missionTs >= Number(snapshot?.ts || 0)
  ));
}
