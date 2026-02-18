import { spawn, exec, execSync, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const children = [];
let hudBaseUrl = "http://localhost:3000";
let shuttingDown = false;
const HUD_DIR = path.join(__dirname, "hud");
const HUD_MODE = String(process.env.NOVA_HUD_MODE || "start").trim().toLowerCase() === "dev" ? "dev" : "start";

function launch(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd: cwd || __dirname,
    stdio: "pipe",
    shell: false,
  });

  child.stdout.on("data", (d) => process.stdout.write(`[${label}] ${d.toString()}`));
  child.stderr.on("data", (d) => process.stdout.write(`[${label}] ${d.toString()}`));
  child.on("exit", (code) => console.log(`[${label}] exited with code ${code}`));

  children.push(child);
  return child;
}

// ===== graceful shutdown =====
function cleanup(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nShutting down Nova...");
  children.forEach((c) => { try { c.kill(); } catch {} });
  process.exit(exitCode);
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

// ===== port management =====
// Single netstat call covers all ports — avoids spawning the command once per port.
function getListeningPids(ports) {
  try {
    const raw = execSync("netstat -ano -p tcp", { encoding: "utf-8" });
    const portSet = new Set(ports.map(Number));
    const pids = new Map(); // port -> Set<pid>

    for (const line of raw.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const localAddress = parts[1] ?? "";
      const pid = Number(parts[4]);
      if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue;
      const colonIdx = localAddress.lastIndexOf(":");
      const port = Number(localAddress.slice(colonIdx + 1));
      if (!portSet.has(port)) continue;
      if (!pids.has(port)) pids.set(port, new Set());
      pids.get(port).add(pid);
    }

    return pids;
  } catch {
    return new Map();
  }
}

function clearPorts(ports) {
  const portPids = getListeningPids(ports);
  for (const [port, pids] of portPids) {
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
        console.log(`[Nova] Cleared port ${port} by stopping PID ${pid}`);
      } catch {}
    }
  }
}

function removeStaleNextLock() {
  const lockPath = path.join(__dirname, "hud", ".next", "dev", "lock");
  try {
    fs.rmSync(lockPath, { force: true });
    // Only log if the file actually existed (rmSync with force doesn't throw when missing)
    if (!fs.existsSync(lockPath)) {
      // silently succeed — no need to log on clean boots
    }
  } catch {}
}

function prepareCleanLaunch() {
  clearPorts([3000, 8765]);
  removeStaleNextLock();
}

function ensureHudBuildIfNeeded() {
  const buildIdPath = path.join(HUD_DIR, ".next", "BUILD_ID");
  if (HUD_MODE !== "start") return;

  const sourcePaths = [
    path.join(HUD_DIR, "app"),
    path.join(HUD_DIR, "components"),
    path.join(HUD_DIR, "lib"),
    path.join(HUD_DIR, "scripts"),
    path.join(HUD_DIR, "package.json"),
    path.join(HUD_DIR, "tsconfig.json"),
    path.join(HUD_DIR, "next.config.ts"),
    path.join(HUD_DIR, "postcss.config.mjs"),
  ];

  function getLatestMtimeMs(targetPath) {
    if (!fs.existsSync(targetPath)) return 0;
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) return stat.mtimeMs;
    if (!stat.isDirectory()) return 0;
    let latest = stat.mtimeMs;
    for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
      if (entry.name === ".next" || entry.name === "node_modules") continue;
      const child = getLatestMtimeMs(path.join(targetPath, entry.name));
      if (child > latest) latest = child;
    }
    return latest;
  }

  const buildExists = fs.existsSync(buildIdPath);
  const buildMtime = buildExists ? fs.statSync(buildIdPath).mtimeMs : 0;
  const sourceMtime = sourcePaths.reduce((max, p) => Math.max(max, getLatestMtimeMs(p)), 0);

  if (buildExists && sourceMtime <= buildMtime) return;

  console.log(`[Nova] ${buildExists ? "HUD build is stale" : "No production HUD build found"}. Building...`);
  execFileSync(process.execPath, ["scripts/next-runner.mjs", "build"], {
    cwd: HUD_DIR,
    stdio: "inherit",
    shell: false,
  });
}

// ===== Detect monitors via PowerShell (no temp file) =====
function getMonitors() {
  try {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {",
      "  $b = $s.Bounds",
      "  Write-Output \"$($b.X)|$($b.Y)|$($b.Width)|$($b.Height)|$($s.Primary)\"",
      "}",
    ].join("\n");

    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const raw = execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
      encoding: "utf-8",
    }).trim();

    const monitors = raw
      .split(/\r?\n/)
      .filter((l) => l.includes("|"))
      .map((line) => {
        const [x, y, width, height, primary] = line.trim().split("|");
        return {
          x: parseInt(x, 10),
          y: parseInt(y, 10),
          width: parseInt(width, 10),
          height: parseInt(height, 10),
          primary: primary === "True",
        };
      });

    monitors.sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      return a.x - b.x;
    });

    console.log(
      `[Nova] Detected ${monitors.length} monitor(s): ` +
      monitors.map((m) => `${m.width}x${m.height} at (${m.x},${m.y})${m.primary ? " [PRIMARY]" : ""}`).join(", "),
    );

    return monitors;
  } catch (e) {
    console.log("[Nova] Could not detect monitors, falling back to default.", e.message);
    return [{ x: 0, y: 0, width: 1920, height: 1080, primary: true }];
  }
}

// ===== Move a browser window to a specific monitor via PowerShell (no temp file) =====
function moveWindowToMonitor(titleMatch, monitor) {
  const { x, y, width, height } = monitor;

  const script = `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32 {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  }
"@
$found = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  $procs = Get-Process | Where-Object { $_.MainWindowTitle -ne "" -and $_.MainWindowTitle -like "*${titleMatch}*" }
  if ($procs -and $procs.Count -gt 0) {
    $p = $procs | Select-Object -First 1
    [Win32]::MoveWindow($p.MainWindowHandle, ${x}, ${y}, ${width}, ${height}, $true)
    [Win32]::ShowWindow($p.MainWindowHandle, 3)
    [Win32]::SetForegroundWindow($p.MainWindowHandle)
    $found = $true
    break
  }
}
if (-not $found) { Write-Output "Window with title *${titleMatch}* not found" }
`.trim();

  const encoded = Buffer.from(script, "utf16le").toString("base64");
  exec(`powershell -NoProfile -EncodedCommand ${encoded}`, (err, stdout) => {
    if (stdout && stdout.trim()) console.log(`[Nova] Window move: ${stdout.trim()}`);
  });
}

async function warmHudRoutes(baseUrl) {
  const routes = ["/home", "/chat", "/history", "/integrations", "/missions", "/analytics"];
  console.log(`[Nova] Pre-warming HUD routes on ${baseUrl} ...`);

  await Promise.allSettled(
    routes.map(async (route) => {
      try {
        const res = await fetch(`${baseUrl}${route}`, { cache: "no-store" });
        console.log(`[Nova] Warmed ${route} -> ${res.status}`);
      } catch (e) {
        console.log(`[Nova] Warm failed ${route}: ${e.message}`);
      }
    }),
  );

  console.log("[Nova] Route pre-warm complete.");
}

// ===== Boot sequence =====
console.log("[Nova] Boot sequence started.");
prepareCleanLaunch();
ensureHudBuildIfNeeded();

const monitors = getMonitors();
const primaryMonitor = monitors[0];

// Start the AI agent and HUD concurrently.
launch("Agent", process.execPath, ["agent.js"], path.join(__dirname, "agent"));

const hudArgs = HUD_MODE === "dev" ? ["scripts/next-runner.mjs", "dev"] : ["scripts/next-runner.mjs", "start"];
const hud = launch("HUD", process.execPath, hudArgs, HUD_DIR);

let hudOpened = false;
hud.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  const localMatch = text.match(/Local:\s+(http:\/\/localhost:\d+)/i);
  if (localMatch) {
    hudBaseUrl = localMatch[1];
    console.log(`[Nova] HUD URL detected: ${hudBaseUrl}`);
  }

  if (text.includes("Ready") && !hudOpened) {
    hudOpened = true;

    const { x, y, width, height } = primaryMonitor;
    const hudTitle = hudBaseUrl.replace(/^https?:\/\//, "");

    exec(
      `start "" msedge.exe ` +
      `--new-window ` +
      `--app=${hudBaseUrl}/boot-right ` +
      `--start-maximized ` +
      `--window-position=${x},${y} ` +
      `--window-size=${width},${height} ` +
      `--autoplay-policy=no-user-gesture-required ` +
      `--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies`,
    );

    console.log("[Nova] Opening Nova app on primary monitor");

    if (process.env.NOVA_FORCE_WINDOW_MOVE === "1") {
      setTimeout(() => {
        moveWindowToMonitor(hudTitle, primaryMonitor);
        moveWindowToMonitor("boot-right", primaryMonitor);
        moveWindowToMonitor("NOVA", primaryMonitor);
      }, 2000);
      setTimeout(() => {
        moveWindowToMonitor(hudTitle, primaryMonitor);
        moveWindowToMonitor("boot-right", primaryMonitor);
        moveWindowToMonitor("NOVA", primaryMonitor);
      }, 5000);
    }

    if (HUD_MODE === "dev") warmHudRoutes(hudBaseUrl);

    console.log("[Nova] Nova launched as standalone app.");
  }
});

console.log(`[Nova] All systems starting... (HUD mode: ${HUD_MODE})`);
