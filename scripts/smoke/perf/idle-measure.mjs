#!/usr/bin/env node
/**
 * Idle-load measurement + browser verification for the HUD / agent runtime (NOT part of any default test chain).
 *
 *   npm run perf:idle                       # 60s visible + 60s hidden, headed Chromium
 *   npm run perf:idle -- --seconds 30       # shorter windows
 *   npm run perf:idle -- --skip-checks      # measurement only
 *   npm run perf:idle -- --no-agent         # HUD only (no agent runtime / no WebSocket checks)
 *   npm run perf:idle -- --headless         # headless: visibility is emulated (real throttling is NOT exercised)
 *   npm run perf:idle -- --port 3100        # HUD port (default 3000; agent gateway is fixed at 8765)
 *
 * What it does
 *   1. Creates a fresh temp NOVA_DATA_DIR (never touches C:\Nova\.user), blanks every key found in the workspace .env
 *      so no real provider key/mic is used, then starts what nova.js starts: the agent runtime entrypoint
 *      (voice stays muted: runtime default) and `next start` (production build; it builds first if hud/.next/BUILD_ID is missing).
 *   2. Correctness checks (skip with --skip-checks): local-request guard (foreign Host / Origin -> 403, local -> 200),
 *      agent WebSocket origin guard (evil Origin -> 403, http://localhost:<port> -> open), the page's own WebSocket,
 *      SSE /api/agent-tasks/stream, and the HUD's own same-origin POSTs (notes, agent task, integrations config).
 *   3. Opens /home in Chromium and measures two windows with no input: VISIBLE (tab focused) and HIDDEN (a second tab
 *      is brought to front so the first becomes document.hidden). Per window it records request counts per endpoint
 *      family (spotify now-playing, notes, dev-logs, missions, agent-tasks, other), WebSocket frames, running CSS
 *      animations, <html data-page-active>, and CPU% (of one core) + working set for: Next server tree, agent runtime
 *      tree, browser (main/renderer/GPU/utility) processes.
 *   4. Kills every process it started (whole trees, via taskkill /T /F) and verifies the ports are closed.
 *
 * Caveats: CPU is from Win32_Process Kernel+UserModeTime deltas (only processes alive at both samples, plus new ones from
 * zero), so short-lived children (e.g. a PowerShell probe) are undercounted; `spawned` counts distinct child pids
 * seen by the 5s sampler (a lower bound). Working set includes shared pages. Windows only.
 * Results are also written as JSON to <tempdir>/idle-measure-result.json.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const HUD_DIR = path.join(ROOT, "hud");
const requireHud = createRequire(path.join(HUD_DIR, "package.json"));
const requireRoot = createRequire(path.join(ROOT, "package.json"));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const SECONDS = Math.max(5, Number.parseInt(opt("seconds", "60"), 10) || 60);
const HUD_PORT = Number.parseInt(opt("port", "3000"), 10) || 3000;
const GATEWAY_PORT = 8765;
const HEADLESS = flag("headless");
const WITH_AGENT = !flag("no-agent");
const WITH_CHECKS = !flag("skip-checks");

if (process.platform !== "win32") {
  console.error("idle-measure: Windows only (uses Win32_Process).");
  process.exit(2);
}

const ownPorts = []; // ports opened by processes this script started
const started = []; // { label, child }
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-idle-"));
const dataDir = path.join(tempRoot, "data");
const profileDir = path.join(tempRoot, "browser-profile");
fs.mkdirSync(dataDir, { recursive: true });
const results = { seconds: SECONDS, port: HUD_PORT, checks: {}, windows: {} };
const log = (...a) => console.log("[idle]", ...a);

// ---------- helpers ----------
function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(1500, () => { s.destroy(); resolve(false); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readDotEnvKeys() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => l.slice(0, l.indexOf("=")).trim()).filter(Boolean);
}

function buildEnv() {
  const env = { ...process.env };
  // Blank every credential the workspace .env could inject (process env wins over next-runner's .env merge).
  for (const key of readDotEnvKeys()) env[key] = "";
  for (const key of Object.keys(env)) if (/(_API_KEY|_TOKEN|_SECRET|_PASSWORD)$/i.test(key)) env[key] = "";
  return {
    ...env,
    NOVA_DATA_DIR: dataDir,
    NEXT_TELEMETRY_DISABLED: "1",
    OPENAI_AGENTS_DISABLE_TRACING: "1",
    NOVA_HUD_API_BASE_URL: `http://127.0.0.1:${HUD_PORT}`,
    NOVA_HUD_PORT: String(HUD_PORT),
    NOVA_RUNTIME_SHARED_TOKEN: randomBytes(32).toString("base64url"),
    NOVA_RUNTIME_REQUIRE_SHARED_TOKEN: "1",
  };
}

function launch(label, args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
  const tail = [];
  const keep = (d) => { tail.push(String(d)); if (tail.length > 60) tail.shift(); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.tail = () => tail.join("");
  started.push({ label, child });
  return child;
}

function killTree(pid) {
  if (!pid) return;
  try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* already gone */ }
}

let browserContext = null;
async function cleanup() {
  try { await browserContext?.close(); } catch { /* ignore */ }
  for (const { child } of started.reverse()) killTree(child.pid);
  // Chromium children carrying our private profile dir (in case context.close did not reap them).
  try {
    for (const p of snapshotProcesses()) if (p.CommandLine && p.CommandLine.includes(profileDir)) killTree(p.ProcessId);
  } catch { /* ignore */ }
}

// ---------- process sampling ----------
function snapshotProcesses() {
  const ps = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,KernelModeTime,UserModeTime,WorkingSetSize | ConvertTo-Json -Compress";
  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({
    ...p,
    cpu100ns: Number(p.KernelModeTime || 0) + Number(p.UserModeTime || 0),
    ws: Number(p.WorkingSetSize || 0),
  }));
}

function descendants(all, rootPid) {
  const byParent = new Map();
  for (const p of all) { if (!byParent.has(p.ParentProcessId)) byParent.set(p.ParentProcessId, []); byParent.get(p.ParentProcessId).push(p); }
  const out = [];
  const stack = [rootPid];
  const seen = new Set();
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const self = all.find((p) => p.ProcessId === pid);
    if (self) out.push(self);
    for (const c of byParent.get(pid) || []) stack.push(c.ProcessId);
  }
  return out;
}

function groups(all) {
  const g = {};
  const next = started.find((s) => s.label === "hud");
  const agent = started.find((s) => s.label === "agent");
  if (next) g.next = descendants(all, next.child.pid);
  if (agent) g.agent = descendants(all, agent.child.pid);
  const chromium = all.filter((p) => p.CommandLine && p.CommandLine.includes(profileDir));
  g.browserMain = chromium.filter((p) => !/--type=/.test(p.CommandLine));
  g.renderer = chromium.filter((p) => /--type=renderer/.test(p.CommandLine));
  g.gpu = chromium.filter((p) => /--type=gpu-process/.test(p.CommandLine));
  g.utility = chromium.filter((p) => /--type=(utility|crashpad-handler)/.test(p.CommandLine));
  return g;
}

function summarize(startSnap, endSnap, seconds) {
  const s = groups(startSnap);
  const e = groups(endSnap);
  const startCpu = new Map(startSnap.map((p) => [p.ProcessId, p.cpu100ns]));
  const out = {};
  for (const name of Object.keys(e)) {
    let cpu = 0;
    let ws = 0;
    for (const p of e[name]) { cpu += p.cpu100ns - (startCpu.get(p.ProcessId) ?? 0); ws += p.ws; }
    out[name] = {
      procs: e[name].length,
      cpuPctOfOneCore: Number(((cpu / 1e7 / seconds) * 100).toFixed(2)),
      workingSetMB: Number((ws / 1048576).toFixed(1)),
    };
  }
  out._startProcs = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.length]));
  return out;
}

// ---------- HTTP checks ----------
function rawRequest({ method = "GET", pathname, headers = {}, body, port = HUD_PORT }) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode }));
    });
    req.on("error", (e) => resolve({ status: 0, error: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

async function runHttpChecks() {
  const c = results.checks;
  const jsonHdr = { "content-type": "application/json" };
  c.get_local = (await rawRequest({ pathname: "/api/dev-logs", headers: { Host: `localhost:${HUD_PORT}` } })).status;
  c.get_foreign_host = (await rawRequest({ pathname: "/api/dev-logs", headers: { Host: "evil.example" } })).status;
  c.get_rebind_host_with_port = (await rawRequest({ pathname: "/api/dev-logs", headers: { Host: `attacker.test:${HUD_PORT}` } })).status;
  c.post_evil_origin = (await rawRequest({ method: "POST", pathname: "/api/home/notes", headers: { ...jsonHdr, Host: `localhost:${HUD_PORT}`, Origin: "http://evil.example" }, body: "{}" })).status;
  c.post_cross_site_fetchsite = (await rawRequest({ method: "POST", pathname: "/api/home/notes", headers: { ...jsonHdr, Host: `localhost:${HUD_PORT}`, "Sec-Fetch-Site": "cross-site" }, body: "{}" })).status;
  c.post_wrong_port_origin = (await rawRequest({ method: "POST", pathname: "/api/home/notes", headers: { ...jsonHdr, Host: `localhost:${HUD_PORT}`, Origin: "http://localhost:9999" }, body: "{}" })).status;
  c.post_local_origin_not403 = (await rawRequest({ method: "POST", pathname: "/api/home/notes", headers: { ...jsonHdr, Host: `localhost:${HUD_PORT}`, Origin: `http://localhost:${HUD_PORT}` }, body: JSON.stringify({ content: "guard check", source: "manual" }) })).status;
  c.post_no_origin_cli_not403 = (await rawRequest({ method: "POST", pathname: "/api/home/notes", headers: { ...jsonHdr, Host: `127.0.0.1:${HUD_PORT}` }, body: JSON.stringify({ content: "cli check", source: "manual" }) })).status;
}

async function runWsChecks() {
  const WebSocket = requireRoot("ws");
  const attempt = (origin) => new Promise((resolve) => {
    const headers = origin ? { Origin: origin } : {};
    const ws = new WebSocket(`ws://127.0.0.1:${GATEWAY_PORT}`, { headers });
    const t = setTimeout(() => { try { ws.terminate(); } catch { /* */ } resolve("timeout"); }, 8000);
    ws.on("open", () => { clearTimeout(t); ws.close(); resolve("open"); });
    ws.on("unexpected-response", (_req, res) => { clearTimeout(t); resolve(`http-${res.statusCode}`); });
    ws.on("error", () => { /* resolved by unexpected-response/timeout */ });
  });
  results.checks.ws_evil_origin = await attempt("http://evil.example");
  results.checks.ws_localhost_origin = await attempt(`http://localhost:${HUD_PORT}`);
  results.checks.ws_no_origin = await attempt(null);
}

// ---------- browser ----------
const FAMILIES = [
  ["spotify", /\/api\/integrations\/spotify\/now-playing/],
  ["notes", /\/api\/home\/notes/],
  ["devLogs", /\/api\/dev-logs/],
  ["missions", /\/api\/missions/],
  ["agentTasks", /\/api\/agent-tasks/],
  ["other/api", /\/api\//],
];
function classify(url) {
  let p = url;
  try { const u = new URL(url); p = u.pathname; } catch { /* */ }
  for (const [name, re] of FAMILIES) if (re.test(p)) return name;
  return null;
}

function newCounters() {
  return { otherUrls: {}, requests: {}, ws: { frames: 0, byType: {} } };
}

async function pageState(page) {
  return page.evaluate(() => {
    const running = document.getAnimations().filter((a) => a.playState === "running").length;
    const paused = document.getAnimations().filter((a) => a.playState === "paused").length;
    const vid = document.querySelector("video");
    return {
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      dataPageActive: document.documentElement.dataset.pageActive ?? null,
      runningAnimations: running,
      pausedAnimations: paused,
      video: vid ? { paused: vid.paused } : null,
    };
  });
}

async function main() {
  for (const port of [HUD_PORT, GATEWAY_PORT]) {
    if (port === GATEWAY_PORT && !WITH_AGENT) continue;
    if (await portOpen(port)) throw new Error(`Port ${port} is already in use; refusing to touch another process. Stop it first.`);
  }
  const env = buildEnv();
  log(`temp data dir: ${dataDir}`);

  if (!fs.existsSync(path.join(HUD_DIR, ".next", "BUILD_ID"))) {
    log("no production build found, running `next build` (minutes, ~2.6GB RAM)...");
    execFileSync(process.execPath, ["scripts/next-runner.mjs", "build"], { cwd: HUD_DIR, env, stdio: "inherit" });
  }

  if (WITH_AGENT) {
    launch("agent", ["src/runtime/core/entrypoint/index.js"], ROOT, env);
    ownPorts.push(GATEWAY_PORT);
    for (let i = 0; i < 60 && !(await portOpen(GATEWAY_PORT)); i++) await sleep(1000);
    if (!(await portOpen(GATEWAY_PORT))) throw new Error(`agent gateway did not open :${GATEWAY_PORT}\n${started.at(-1).child.tail()}`);
    log("agent gateway up");
  }
  ownPorts.push(HUD_PORT);
  const hud = launch("hud", ["scripts/next-runner.mjs", "start", "-p", String(HUD_PORT)], HUD_DIR, env);
  for (let i = 0; i < 90 && !(await portOpen(HUD_PORT)); i++) await sleep(1000);
  if (!(await portOpen(HUD_PORT))) throw new Error(`HUD did not start on :${HUD_PORT}\n${hud.tail()}`);
  log("HUD up");

  if (WITH_CHECKS) {
    await runHttpChecks();
    if (WITH_AGENT) await runWsChecks();
  }

  const { chromium } = requireHud("playwright-core");
  browserContext = await chromium.launchPersistentContext(profileDir, {
    headless: HEADLESS,
    viewport: { width: 1600, height: 900 },
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = browserContext.pages()[0] ?? (await browserContext.newPage());
  let counters = newCounters();
  const statuses = { devLogs: {}, spotify: {} };
  page.on("request", (req) => {
    const fam = classify(req.url());
    if (fam) counters.requests[fam] = (counters.requests[fam] || 0) + 1;
    if (fam === "other/api") { const k = new URL(req.url()).pathname; counters.otherUrls[k] = (counters.otherUrls[k] || 0) + 1; }
  });
  page.on("response", (res) => {
    const fam = classify(res.url());
    if (fam === "devLogs" || fam === "spotify") statuses[fam][res.status()] = (statuses[fam][res.status()] || 0) + 1;
  });
  const wsUrls = [];
  page.on("websocket", (ws) => {
    wsUrls.push(ws.url());
    ws.on("framereceived", (f) => {
      counters.ws.frames += 1;
      try { const t = JSON.parse(String(f.payload)).type || "?"; counters.ws.byType[t] = (counters.ws.byType[t] || 0) + 1; } catch { counters.ws.byType["(non-json)"] = (counters.ws.byType["(non-json)"] || 0) + 1; }
    });
  });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });

  // Seed a "connected" Spotify integration with dummy tokens (temp data dir only) and stub now-playing so no outbound call is made.
  await rawRequest({ method: "PATCH", pathname: "/api/integrations/config", headers: { "content-type": "application/json", Host: `127.0.0.1:${HUD_PORT}` }, body: JSON.stringify({ spotify: { connected: true, accessTokenEnc: "dummy", refreshTokenEnc: "dummy", oauthClientId: "dummy", spotifyUserId: "perf", displayName: "perf" } }) });
  await page.route("**/api/integrations/spotify/now-playing", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, connected: true, nowPlaying: null }) }));
  await page.goto(`http://localhost:${HUD_PORT}/home`, { waitUntil: "load" });
  await page.waitForTimeout(6000); // let initial fetches, WebSocket handshake and route hydration settle

  if (WITH_CHECKS) {
    const c = results.checks;
    c.page_websocket_urls = [...wsUrls];
    c.page_websocket_open = await page.evaluate(() => new Promise((resolve) => {
      const ws = new WebSocket("ws://localhost:8765");
      const t = setTimeout(() => resolve("timeout"), 6000);
      ws.onopen = () => { clearTimeout(t); ws.close(); resolve("open"); };
      ws.onerror = () => { clearTimeout(t); resolve("error"); };
    }));
    c.sse_agent_tasks_stream = await page.evaluate(() => new Promise((resolve) => {
      const es = new EventSource("/api/agent-tasks/stream");
      const t = setTimeout(() => { es.close(); resolve("timeout"); }, 6000);
      es.onopen = () => { clearTimeout(t); es.close(); resolve("open"); };
      es.onerror = () => { clearTimeout(t); es.close(); resolve("error"); };
    }));
    const post = (url, body) => page.evaluate(async ([u, b]) => {
      const r = await fetch(u, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
      return r.status;
    }, [url, body]);
    c.page_post_note = await post("/api/home/notes", { content: "perf-check note", source: "manual" });
    c.page_post_agent_task = await post("/api/agent-tasks", { name: "perf-check", prompt: "noop", agent: "openai", model: "gpt-4o-mini" });
    c.page_patch_integrations_config = await page.evaluate(async () => {
      const r = await fetch("/api/integrations/config", { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ brave: { enabled: false } }) });
      return r.status;
    });
    // Cross-site page (served by a route stub) posting to the HUD: must be blocked by the guard.
    const evil = await browserContext.newPage();
    await evil.route("http://evil.example/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>x</body></html>" }));
    await evil.goto("http://evil.example/");
    await evil.evaluate((port) => fetch(`http://localhost:${port}/api/home/notes`, { method: "POST", mode: "no-cors", headers: { "content-type": "text/plain" }, body: JSON.stringify({ content: "evil-cross-site-note", source: "manual" }) }).then(() => "sent", () => "blocked-by-browser"), HUD_PORT);
    await evil.waitForTimeout(1500);
    const notesJson = await page.evaluate(async () => (await fetch("/api/home/notes", { cache: "no-store" })).text());
    c.evil_page_cross_site_post_created_note = notesJson.includes("evil-cross-site-note"); // must be false
    await evil.close();
    await page.bringToFront();
    await page.waitForTimeout(500);
  }

  // ---- VISIBLE window ----
  counters = newCounters();
  const beforeVisibleState = await pageState(page);
  log(`measuring VISIBLE for ${SECONDS}s (do not touch the browser window)`);
  const visStart = snapshotProcesses();
  const spawnedVisible = await sampleSpawns(SECONDS);
  const visEnd = snapshotProcesses();
  results.windows.visible = {
    state: beforeVisibleState,
    stateAtEnd: await pageState(page),
    requestsPerMinute: perMinute(counters.requests, SECONDS),
    requests: counters.requests,
    otherApiUrls: counters.otherUrls,
    wsFramesPerMinute: Number(((counters.ws.frames / SECONDS) * 60).toFixed(1)),
    wsByType: counters.ws.byType,
    processes: summarize(visStart, visEnd, SECONDS),
    childPidsSeen: spawnedVisible,
  };

  // ---- HIDDEN window ----
  const other = await browserContext.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await sleep(1500); // > 250ms page-active debounce
  let hiddenState = await pageState(page);
  let emulated = false;
  if (hiddenState.visibilityState !== "hidden") {
    // Headless (or a window manager that keeps both visible): emulate the hide so the JS logic is still exercised.
    emulated = true;
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.hasFocus = () => false;
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("blur"));
    });
    await sleep(1000);
    hiddenState = await pageState(page);
  }
  counters = newCounters();
  log(`measuring HIDDEN for ${SECONDS}s${emulated ? " (emulated hide)" : ""}`);
  const hidStart = snapshotProcesses();
  const spawnedHidden = await sampleSpawns(SECONDS);
  const hidEnd = snapshotProcesses();
  results.windows.hidden = {
    emulatedVisibility: emulated,
    state: hiddenState,
    stateAtEnd: await pageState(page),
    requestsPerMinute: perMinute(counters.requests, SECONDS),
    requests: counters.requests,
    otherApiUrls: counters.otherUrls,
    wsFramesPerMinute: Number(((counters.ws.frames / SECONDS) * 60).toFixed(1)),
    wsByType: counters.ws.byType,
    processes: summarize(hidStart, hidEnd, SECONDS),
    childPidsSeen: spawnedHidden,
  };
  results.statuses = statuses;
  results.consoleErrors = consoleErrors.slice(0, 10);

  // Return to visible: a catch-up poll should fire and animations resume.
  counters = newCounters();
  await page.bringToFront();
  if (emulated) {
    await page.evaluate(() => {
      delete document.hidden; delete document.visibilityState; delete document.hasFocus;
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
  }
  await sleep(3000);
  results.windows.resumed = { state: await pageState(page), requestsIn3s: counters.requests };

  // ---- Request-only windows for other pages (missions pollers, dev-logs poll + ETag/304) ----
  results.pages = {};
  const rSecs = Math.min(SECONDS, 45);
  for (const route of ["/missions", "/dev-logs"]) {
    await page.goto(`http://localhost:${HUD_PORT}${route}`, { waitUntil: "load" });
    await page.waitForTimeout(5000);
    const entry = {};
    for (const mode of ["visible", "hidden"]) {
      if (mode === "hidden") {
        await other.bringToFront();
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
          document.hasFocus = () => false;
          document.dispatchEvent(new Event("visibilitychange"));
          window.dispatchEvent(new Event("blur"));
        });
        await sleep(1000);
      }
      counters = newCounters();
      statuses.devLogs = {};
      await sleep(rSecs * 1000);
      entry[mode] = { seconds: rSecs, requests: counters.requests, otherApiUrls: counters.otherUrls, devLogsStatuses: { ...statuses.devLogs } };
    }
    results.pages[route] = entry;
  }
}

function perMinute(reqs, seconds) {
  return Object.fromEntries(Object.entries(reqs).map(([k, v]) => [k, Number(((v / seconds) * 60).toFixed(1))]));
}

// Sleeps for `seconds`, sampling the process list every 5s to count distinct child pids of the agent/next trees.
async function sampleSpawns(seconds) {
  const seen = { next: new Set(), agent: new Set() };
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end - 1500) {
    await sleep(Math.min(5000, Math.max(0, end - Date.now() - 1500)));
    const g = groups(snapshotProcesses());
    for (const k of ["next", "agent"]) for (const p of g[k] || []) seen[k].add(p.ProcessId);
  }
  const left = end - Date.now();
  if (left > 0) await sleep(left);
  return { next: seen.next.size, agent: seen.agent.size };
}

let exitCode = 0;
try {
  await main();
} catch (err) {
  exitCode = 1;
  console.error("[idle] FAILED:", err instanceof Error ? err.stack || err.message : err);
} finally {
  await cleanup();
  await sleep(1500);
  const still = [];
  for (const port of ownPorts) if (await portOpen(port)) still.push(port);
  results.portsClosedAfterCleanup = still.length === 0;
  if (still.length) { console.error(`[idle] ports still open after cleanup: ${still.join(",")}`); exitCode = 1; }
  const resultPath = path.join(tempRoot, "idle-measure-result.json");
  fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log(`[idle] result JSON: ${resultPath}`);
  process.exit(exitCode);
}
