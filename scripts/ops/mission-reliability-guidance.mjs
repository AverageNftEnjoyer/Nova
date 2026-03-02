export const MISSION_RELIABILITY_ACTIONS = Object.freeze({
  failedRun: "Apply Immediate Mitigations -> Run success regression.",
  stuckQueue: "Apply Immediate Mitigations -> Run p95 breach / queue pressure.",
  restoreFailure: "Apply Immediate Mitigations -> Restore path.",
});

const SLO_TARGETS = Object.freeze([
  "Validation pass rate >= 98%",
  "Run success rate >= 97%",
  "Retry rate <= 10%",
  "Run p95 latency <= 30000 ms",
]);

const TRIAGE_STEPS = Object.freeze([
  "Confirm SLO breach in reliability API and identify failed metric.",
  "Filter telemetry by eventType and status for the affected period.",
  "Correlate with recent mission changes in mission version and diff journals.",
  "Identify impact scope (single mission vs multi-mission, single user vs broad).",
]);

const IMMEDIATE_MITIGATIONS = Object.freeze([
  "Build failure spike: verify provider health, validate idempotency path, and roll back prompt changes.",
  "Validation pass-rate drop: review policy/profile rollouts and apply autofix preview for common classes.",
  "Run success regression: inspect failed node traces, verify output dispatch, and pause failing mission(s).",
  "Retry-rate spike: identify transient integration faults and reduce trigger volume with safer pacing.",
  "Run p95 breach: inspect mission complexity/external latency and split oversized workflows.",
]);

const ESCALATION_STEPS = Object.freeze([
  "If SLO remains breached for > 60 minutes after mitigation, escalate to runtime and mission on-call owners.",
  "If cross-user impact is suspected, run isolation smokes and disable high-risk rollout.",
]);

function renderList(sectionTitle, entries) {
  return [
    `### ${sectionTitle}`,
    ...entries.map((entry, index) => `${index + 1}. ${entry}`),
    "",
  ];
}

export function renderMissionReliabilityGuidanceMarkdown() {
  return [
    "## Mission Reliability Guidance",
    "",
    ...renderList("SLO Targets", SLO_TARGETS),
    ...renderList("Triage Steps", TRIAGE_STEPS),
    ...renderList("Immediate Mitigations", IMMEDIATE_MITIGATIONS),
    ...renderList("Escalation", ESCALATION_STEPS),
  ];
}

