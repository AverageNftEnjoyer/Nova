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

  child.stdout.on("data", (d) =>
    process.stdout.write(`[${label}] ${d}`)
  );
  child.stderr.on("data", (d) =>
    process.stdout.write(`[${label}] ${d}`)
  );
  child.on("exit", (code) =>
    console.log(`[${label}] exited with code ${code}`)
  );

  children.push(child);
  return child;
}

// ===== graceful shutdown =====
function cleanup(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nShutting down Nova...");
  children.forEach((c) => {
    try { c.kill(); } catch {}
  });
  process.exit(exitCode);
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

function getListeningPids(port) {
  try {
    const raw = execSync("netstat -ano -p tcp", { encoding: "utf-8" });
    const lines = raw.split(/\r?\n/);
    const pids = new Set();

    for (const line of lines) {
      if (!line.includes("LISTENING")) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;

      const localAddress = parts[1] || "";
      const pid = Number(parts[4]);
      if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue;
      if (localAddress.endsWith(`:${port}`)) {
        pids.add(pid);
      }
    }

    return [...pids];
  } catch {
    return [];
  }
}

function clearPort(port) {
  const pids = getListeningPids(port);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
      console.log(`[Nova] Cleared port ${port} by stopping PID ${pid}`);
    } catch {}
  }
}

function removeStaleNextLock() {
  const lockPath = path.join(__dirname, "hud", ".next", "dev", "lock");
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
      console.log("[Nova] Removed stale Next.js dev lock.");
    }
  } catch {}
}

function prepareCleanLaunch() {
  // If prior sessions crashed, these can block startup and leave the app window blank.
  clearPort(8765);
  clearPort(3000);
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
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".next" || entry.name === "node_modules") continue;
      const full = path.join(targetPath, entry.name);
      const entryLatest = getLatestMtimeMs(full);
      if (entryLatest > latest) latest = entryLatest;
    }
    return latest;
  }

  const buildExists = fs.existsSync(buildIdPath);
  const buildMtime = buildExists ? fs.statSync(buildIdPath).mtimeMs : 0;
  const sourceMtime = sourcePaths.reduce((max, p) => Math.max(max, getLatestMtimeMs(p)), 0);
  const buildIsStale = !buildExists || sourceMtime > buildMtime;

  if (!buildIsStale) return;
  console.log(`[Nova] ${buildExists ? "HUD build is stale" : "No production HUD build found"}. Building...`);
  execFileSync(process.execPath, ["scripts/next-runner.mjs", "build"], {
    cwd: HUD_DIR,
    stdio: "inherit",
    shell: false,
  });
}

// ===== Detect monitors via PowerShell =====
function getMonitors() {
  try {
    const psScript = path.join(__dirname, "_monitors.ps1");
    fs.writeFileSync(psScript, `
Add-Type -AssemblyName System.Windows.Forms
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
  $b = $s.Bounds
  Write-Output "$($b.X)|$($b.Y)|$($b.Width)|$($b.Height)|$($s.Primary)"
}
`, "utf-8");

    const raw = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}"`, {
      encoding: "utf-8",
    }).trim();

    try { fs.unlinkSync(psScript); } catch {}

    const monitors = raw.split(/\r?\n/).filter(l => l.includes("|")).map((line) => {
      const parts = line.trim().split("|");
      return {
        x: parseInt(parts[0]),
        y: parseInt(parts[1]),
        width: parseInt(parts[2]),
        height: parseInt(parts[3]),
        primary: parts[4] === "True",
      };
    });

    monitors.sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      return a.x - b.x;
    });

    console.log(`[Nova] Detected ${monitors.length} monitor(s):`, monitors.map(m =>
      `${m.width}x${m.height} at (${m.x},${m.y})${m.primary ? " [PRIMARY]" : ""}`
    ).join(", "));

    return monitors;
  } catch (e) {
    console.log("[Nova] Could not detect monitors, falling back to default.", e.message);
    return [{ x: 0, y: 0, width: 1920, height: 1080, primary: true }];
  }
}

// ===== Move a browser window to a specific monitor via PowerShell =====
function moveWindowToMonitor(titleMatch, monitor) {
  const { x, y, width, height } = monitor;
  const psScript = path.join(__dirname, `_move_${Date.now()}.ps1`);
  fs.writeFileSync(psScript, `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32 {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  }
"@

# Wait for the window to appear
$found = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  $procs = Get-Process | Where-Object {
    $_.MainWindowTitle -ne "" -and
    $_.MainWindowTitle -like "*${titleMatch}*"
  }
  if ($procs -and $procs.Count -gt 0) {
    $p = $procs | Select-Object -First 1
    [Win32]::MoveWindow($p.MainWindowHandle, ${x}, ${y}, ${width}, ${height}, $true)
    # SW_MAXIMIZE = 3
    [Win32]::ShowWindow($p.MainWindowHandle, 3)
    [Win32]::SetForegroundWindow($p.MainWindowHandle)
    $found = $true
    break
  }
}
if (-not $found) {
  Write-Output "Window with title *${titleMatch}* not found"
}
`, "utf-8");

  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}"`, (err, stdout) => {
    if (stdout && stdout.trim()) console.log(`[Nova] Window move: ${stdout.trim()}`);
    try { fs.unlinkSync(psScript); } catch {}
  });
}

async function warmHudRoutes(baseUrl) {
  const routes = ["/home", "/chat", "/history", "/integrations", "/missions"];
  console.log(`[Nova] Pre-warming HUD routes on ${baseUrl} ...`);

  const tasks = routes.map(async (route) => {
    const url = `${baseUrl}${route}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      console.log(`[Nova] Warmed ${route} -> ${res.status}`);
    } catch (e) {
      console.log(`[Nova] Warm failed ${route}: ${e.message}`);
    }
  });

  await Promise.allSettled(tasks);
  console.log("[Nova] Route pre-warm complete.");
}

console.log("[Nova] Boot sequence started.");
prepareCleanLaunch();
ensureHudBuildIfNeeded();

// ===== 2. Detect monitors =====
const monitors = getMonitors();
const primaryMonitor = monitors[0];
const secondaryMonitor = monitors.length > 1 ? monitors[1] : null;

// ===== 3. Start the AI agent =====
launch("Agent", process.execPath, ["agent.js"], path.join(__dirname, "agent"));

// ===== 4. Start the HUD dev server =====
const hudArgs = HUD_MODE === "dev" ? ["scripts/next-runner.mjs", "dev"] : ["scripts/next-runner.mjs", "start"];
const hud = launch("HUD", process.execPath, hudArgs, HUD_DIR);

// ===== 5. Open HUD as standalone app on primary monitor =====
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

    // Launch Edge in app mode with aggressive fullscreen + autoplay flags.
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
      `--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies`
    );
    console.log("[Nova] Opening Nova app on primary monitor");
    // Keep launch deterministic and avoid post-launch monitor jumps.
    // To force window placement again, set NOVA_FORCE_WINDOW_MOVE=1.
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

    if (HUD_MODE === "dev") {
      warmHudRoutes(hudBaseUrl);
    }
    console.log("[Nova] Nova launched as standalone app.");
  }
});

console.log(`[Nova] All systems starting... (HUD mode: ${HUD_MODE})`);
