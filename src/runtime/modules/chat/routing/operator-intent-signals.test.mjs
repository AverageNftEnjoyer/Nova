import test from "node:test";
import assert from "node:assert/strict";

import { isFilesDirectIntent } from "./operator-intent-signals/index.js";

test("files intent ignores conversational mentions of project metadata", () => {
  assert.equal(isFilesDirectIntent("My project codename is Aurora-7."), false);
  assert.equal(isFilesDirectIntent("What is the project codename?"), false);
});

test("files intent still matches explicit workspace operations", () => {
  assert.equal(isFilesDirectIntent("list files in src"), true);
  assert.equal(isFilesDirectIntent("read hud/package.json"), true);
  assert.equal(isFilesDirectIntent("search auth token in workspace"), true);
  assert.equal(isFilesDirectIntent("write notes.txt: hello"), true);
});
