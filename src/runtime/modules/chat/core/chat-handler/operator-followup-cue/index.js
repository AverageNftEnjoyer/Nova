export function hasFollowUpContinuationCue(input = {}) {
  const {
    normalizedTextForRouting = "",
    policies = [],
  } = input;

  for (const policy of policies) {
    if (!policy) continue;
    if (
      policy.isNonCriticalFollowUp(normalizedTextForRouting)
      && !policy.isCancel(normalizedTextForRouting)
      && !policy.isNewTopic(normalizedTextForRouting)
    ) {
      return true;
    }
  }

  return false;
}
