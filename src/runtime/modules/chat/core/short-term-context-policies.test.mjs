import test from "node:test";
import assert from "node:assert/strict";

import { classifyShortTermContextTurn } from "./short-term-context-policies/index.js";

test("assistant follow-up classification includes conversation-local recall prompts", () => {
  const recallTurn = classifyShortTermContextTurn({
    domainId: "assistant",
    text: "What two personal facts did I share at the start?",
  });
  assert.equal(recallTurn.isNonCriticalFollowUp, true);
  assert.equal(recallTurn.isNewTopic, false);
  assert.equal(recallTurn.isCancel, false);
});
