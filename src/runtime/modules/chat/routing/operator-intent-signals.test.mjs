import test from "node:test";
import assert from "node:assert/strict";

import {
  isFilesDirectIntent,
  isImageDirectIntent,
  isImageContextualFollowUpIntent,
} from "./operator-intent-signals/index.js";

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

test("image intent matches explicit image generation prompts only", () => {
  assert.equal(isImageDirectIntent("generate an image of a cyberpunk skyline"), true);
  assert.equal(isImageDirectIntent("create a photo-real picture of an african safari"), true);
  assert.equal(isImageDirectIntent("show me images of tokyo at night"), false);
  assert.equal(isImageDirectIntent("find photos of solar eclipses"), false);
  assert.equal(isImageDirectIntent("tell me about african safari habitats"), false);
});

test("image contextual follow-up intent matches image refinement prompts", () => {
  assert.equal(isImageContextualFollowUpIntent("make another image variation"), true);
  assert.equal(isImageContextualFollowUpIntent("upscale this image"), true);
  assert.equal(isImageContextualFollowUpIntent("describe this image"), true);
});
