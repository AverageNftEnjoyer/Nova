import {
  OPERATOR_LANE_SEQUENCE,
  resolveOperatorLaneKeyPrefix,
} from "../operator-lane-config/index.js";

export function buildOperatorLanePolicies(getShortTermContextPolicy) {
  if (typeof getShortTermContextPolicy !== "function") {
    throw new Error("buildOperatorLanePolicies requires getShortTermContextPolicy");
  }

  const lanePolicies = {};
  for (const lane of OPERATOR_LANE_SEQUENCE) {
    const keyPrefix = resolveOperatorLaneKeyPrefix(lane);
    lanePolicies[`${keyPrefix}Policy`] = getShortTermContextPolicy(lane.domainId);
  }
  return lanePolicies;
}
