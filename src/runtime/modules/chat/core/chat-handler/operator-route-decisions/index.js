import { OPERATOR_LANE_SEQUENCE } from "../operator-lane-config/index.js";

function isIntentMatch(intentFn, text) {
  return typeof intentFn === "function" && intentFn(text) === true;
}

function buildDecisionObject(selectedRouteId = "") {
  const decisions = {};
  for (const lane of OPERATOR_LANE_SEQUENCE) {
    decisions[lane.shouldRouteFlag] = lane.id === selectedRouteId;
  }
  return decisions;
}

export function buildOperatorRouteDecisions(input = {}) {
  const text = String(input.text || "");
  const directIntents = {};

  for (const lane of OPERATOR_LANE_SEQUENCE) {
    directIntents[lane.id] = isIntentMatch(input[lane.directIntentFnKey], text);
  }

  const routeCandidates = OPERATOR_LANE_SEQUENCE.map((lane) => {
    const shortTermFollowUp = input[lane.shortTermFollowUpFlag] === true;
    const blockedByRouteId = lane.followUpBlockedByDirectRouteId;
    const followUpBlocked = blockedByRouteId ? directIntents[blockedByRouteId] === true : false;
    const match = directIntents[lane.id] || (shortTermFollowUp && !followUpBlocked);
    return { routeId: lane.id, match };
  });

  const selectedRouteId = routeCandidates.find((candidate) => candidate.match)?.routeId || "";
  const routeDecisions = buildDecisionObject(selectedRouteId);

  return {
    ...routeDecisions,
    selectedRouteId,
    directIntents,
  };
}
