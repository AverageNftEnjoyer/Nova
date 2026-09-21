import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

const results = [];
async function run(name, fn) {
  try {
    await fn();
    results.push({ ok: true, name });
    console.log(`[PASS] ${name}`);
  } catch (error) {
    results.push({ ok: false, name });
    console.log(`[FAIL] ${name} :: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Returns [{ name, body }] for every top-level @keyframes block. */
function extractKeyframes(css) {
  const blocks = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push({ name: m[1], body: css.slice(re.lastIndex, i - 1) });
  }
  return blocks;
}

// One-shot intro animations (`forwards`, not `infinite`) may animate blur.
const ONE_SHOT_BLUR_KEYFRAMES = new Set(["orb-intro", "text-blur-intro"]);
// utilities.css one-shot (`forwards`) streaming-text reveal.
const ONE_SHOT_FILTER_KEYFRAMES = new Set(["blur-reveal"]);

await run("PA-1 PageActiveController sets data-page-active from visibility + focus, debounced", () => {
  const src = read("hud/components/background/page-active-controller.tsx");
  assert.match(src, /usePageActive/);
  assert.match(src, /dataset\.pageActive\s*=\s*"true"/);
  assert.match(src, /dataset\.pageActive\s*=\s*"false"/);
  assert.match(src, /INACTIVE_DEBOUNCE_MS\s*=\s*250/);
  const hook = read("hud/lib/hooks/use-page-active/index.ts");
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /"blur"/);
});

await run("PA-2 controller is mounted in the root layout", () => {
  const layout = read("hud/app/layout.tsx");
  assert.match(layout, /import \{ PageActiveController \}/);
  assert.match(layout, /<PageActiveController \/>/);
});

await run("PA-3 global pause rule exists in utilities.css", () => {
  const css = read("hud/app/styles/utilities.css");
  assert.match(css, /html\[data-page-active="false"\] \*,/);
  assert.match(css, /html\[data-page-active="false"\] \*::before,/);
  assert.match(css, /html\[data-page-active="false"\] \*::after\s*\{\s*animation-play-state:\s*paused !important;/);
});

await run("KF-1 utilities.css keyframes never animate filter (one-shot reveal exempt)", () => {
  const css = read("hud/app/styles/utilities.css");
  const offenders = extractKeyframes(css).filter((k) => !ONE_SHOT_FILTER_KEYFRAMES.has(k.name) && /\bfilter\s*:/.test(k.body)).map((k) => k.name);
  assert.deepEqual(offenders, [], `filter animated in: ${offenders.join(", ")}`);
});

await run("KF-2 spotify glow animates at most 3 layers and has no hue-rotate keyframes", () => {
  const css = read("hud/app/styles/utilities.css");
  const glowClasses = [...css.matchAll(/^\.animate-spotify-glow-[\w-]+\s*\{[^}]*\banimation:/gm)];
  assert.ok(glowClasses.length <= 3, `expected <= 3 animated glow layers, found ${glowClasses.length}`);
  const glowKeyframes = extractKeyframes(css).filter((k) => k.name.startsWith("spotify-glow"));
  assert.ok(glowKeyframes.every((k) => !/hue-rotate|blur\(/.test(k.body)));
});

await run("KF-3 orb-animations.css keyframes never animate blur (one-shot intros exempt)", () => {
  const css = read("hud/app/styles/orb-animations.css");
  const offenders = extractKeyframes(css)
    .filter((k) => !ONE_SHOT_BLUR_KEYFRAMES.has(k.name) && /blur\(/.test(k.body))
    .map((k) => k.name);
  assert.deepEqual(offenders, [], `blur animated in: ${offenders.join(", ")}`);
  for (const name of ONE_SHOT_BLUR_KEYFRAMES) {
    assert.ok(!new RegExp(`animation:\s*${name}[^;]*infinite`).test(css), `${name} must stay one-shot`);
  }
});

await run("RM-1 reduced-motion disables glow and orb loops", () => {
  assert.match(read("hud/app/styles/utilities.css"), /prefers-reduced-motion: reduce\)[\s\S]*animate-spotify-glow-a[\s\S]*animation:\s*none !important/);
  assert.match(read("hud/app/styles/orb-animations.css"), /prefers-reduced-motion: reduce\)[\s\S]*nova-orb-core-shell[\s\S]*animation:\s*none !important/);
});

await run("MC-1 mission edge flow is slowed to >= 1.6s", () => {
  const css = read("hud/app/styles/mission-canvas.css");
  const m = css.match(/mission-edge-flow\s+([\d.]+)s\s+linear\s+infinite/);
  assert.ok(m, "mission-edge-flow animation not found");
  assert.ok(Number(m[1]) >= 1.6, `duration ${m[1]}s too fast`);
});

await run("BG-1 background video pauses when the page is inactive and uses preload=metadata", () => {
  const src = read("hud/components/background/app-background-layer.tsx");
  assert.match(src, /data-page-active/);
  assert.match(src, /video\.pause\(\)/);
  assert.match(src, /video\.play\(\)/);
  assert.match(src, /preload="metadata"/);
  assert.doesNotMatch(src, /preload="auto"/);
});

await run("EL-1 Electron DevTools are gated behind NOVA_DEVTOOLS and debug logs are gone", () => {
  const src = read("hud/electron/main.js");
  const idx = src.indexOf("openDevTools()");
  assert.ok(idx > -1, "openDevTools call missing");
  const before = src.slice(Math.max(0, idx - 120), idx);
  assert.match(before, /process\.env\.NOVA_DEVTOOLS === '1'/);
  assert.equal(src.split("openDevTools()").length - 1, 1);
  assert.doesNotMatch(src, /console\.log\('Electron loaded/);
  assert.doesNotMatch(src, /console\.log\('app:'/);
  assert.match(src, /backgroundThrottling:\s*true/);
  assert.match(read(".env.example"), /^NOVA_DEVTOOLS=/m);
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\nperf-ui source guards: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
