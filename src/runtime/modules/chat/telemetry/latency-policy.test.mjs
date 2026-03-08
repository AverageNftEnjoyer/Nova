import test from "node:test";
import assert from "node:assert/strict";

import { buildLatencyTurnPolicy, shouldAttemptMemoryRecallTurn } from "./latency-policy/index.js";

test("memory recall stays off for ordinary follow-ups and fact statements", () => {
  assert.equal(shouldAttemptMemoryRecallTurn("My project codename is Aurora-7."), false);
  assert.equal(shouldAttemptMemoryRecallTurn("Summarize that checklist in 3 bullet points."), false);
  assert.equal(buildLatencyTurnPolicy("What two personal facts did I share at the start?").memoryRecallCandidate, false);
});

test("memory recall stays available for explicit recall prompts", () => {
  assert.equal(shouldAttemptMemoryRecallTurn("What did I ask you to call me earlier?"), true);
  assert.equal(shouldAttemptMemoryRecallTurn("Resume the earlier conversation about deployment."), true);
  assert.equal(shouldAttemptMemoryRecallTurn("What was the region I told you before?"), true);
});
