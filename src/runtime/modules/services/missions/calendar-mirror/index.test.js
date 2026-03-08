import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMissionScheduleMirrorEventId,
  collectMirroredMissionIdsForDeletion,
  isMissionScheduleMirrorCandidate,
} from "./index.js";

test("buildMissionScheduleMirrorEventId returns a stable novamission-prefixed id", () => {
  const first = buildMissionScheduleMirrorEventId("user-a", "mission-1");
  const second = buildMissionScheduleMirrorEventId("user-a", "mission-1");
  const other = buildMissionScheduleMirrorEventId("user-a", "mission-2");

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^novamission[a-v0-9]{20,}$/);
});

test("isMissionScheduleMirrorCandidate only accepts active missions with a schedule trigger", () => {
  assert.equal(
    isMissionScheduleMirrorCandidate({
      id: "mission-a",
      status: "active",
      nodes: [{ type: "schedule-trigger" }, { type: "web-search" }],
    }),
    true,
  );
  assert.equal(
    isMissionScheduleMirrorCandidate({
      id: "mission-b",
      status: "draft",
      nodes: [{ type: "schedule-trigger" }],
    }),
    false,
  );
  assert.equal(
    isMissionScheduleMirrorCandidate({
      id: "mission-c",
      status: "active",
      nodes: [{ type: "web-search" }],
    }),
    false,
  );
});

test("collectMirroredMissionIdsForDeletion only deletes mirror candidates with explicit missing state", () => {
  const missions = [
    { id: "delete-me", status: "active", nodes: [{ type: "schedule-trigger" }] },
    { id: "keep-existing", status: "active", nodes: [{ type: "schedule-trigger" }] },
    { id: "ignore-error", status: "active", nodes: [{ type: "schedule-trigger" }] },
    { id: "ignore-draft", status: "draft", nodes: [{ type: "schedule-trigger" }] },
  ];
  const lookup = new Map([
    ["delete-me", "missing"],
    ["keep-existing", "exists"],
    ["ignore-error", "error"],
    ["ignore-draft", "missing"],
  ]);

  assert.deepEqual(collectMirroredMissionIdsForDeletion(missions, lookup), ["delete-me"]);
});
