import { spawn, exec, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const children = [];

function launch(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd: cwd || __dirname,
    stdio: "pipe",
    shell: true,
  });

  child.stdout.on("data", (d) =>
    process.stdout.write(`[${label}] ${d}`)
  );
  child.stderr.on("data", (d) =>
    process.stderr.write(`[${label}] ${d}`)
  );
  child.on("exit", (code) =>
    console.log(`[${label}] exited with code ${code}`)
  );

  children.push(child);
  return child;
}

// ===== graceful shutdown =====
function cleanup() {
  console.log("\nShutting down Nova...");
  children.forEach((c) => {
    try { c.kill(); } catch {}
  });
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);

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
    [Win32]::ShowWindow($p.MainWindowHandle, 3)
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

// ===== 1. Play bootup sound =====
const mpv = path.join(__dirname, "agent", "mpv", "mpv.exe");
const bootSound = path.join(__dirname, "hud", "public", "sounds", "hth.mp3");

const bootAudio = spawn(mpv, [
  bootSound,
  "--no-video",
  "--really-quiet",
  "--keep-open=no",
  `--end=26`,
  `--volume=80`,
]);
bootAudio.on("exit", () => console.log("[Nova] Boot sound finished."));

console.log("[Nova] Boot sequence started.");

// ===== 2. Detect monitors =====
const monitors = getMonitors();
const primaryMonitor = monitors[0];
const secondaryMonitor = monitors.length > 1 ? monitors[1] : null;

// ===== 3. Start the AI agent =====
launch("Agent", "node", ["agent.js"], path.join(__dirname, "agent"));

// ===== 4. Start the HUD dev server =====
const hud = launch("HUD", "npm", ["run", "dev"], path.join(__dirname, "hud"));

// ===== 5. Open HUD as standalone app on primary monitor =====
let hudOpened = false;
hud.stdout.on("data", (chunk) => {
  if (chunk.toString().includes("Ready") && !hudOpened) {
    hudOpened = true;

    // Launch Edge in app mode — shows as its own program in the taskbar (no browser UI)
    exec(`start msedge.exe --app=http://localhost:3000/boot-right --start-maximized --window-size=${primaryMonitor.width},${primaryMonitor.height} --window-position=${primaryMonitor.x},${primaryMonitor.y}`);
    console.log("[Nova] Opening Nova app on primary monitor");

    // Maximize the window on the primary monitor after it appears
    setTimeout(() => {
      const psScript = path.join(__dirname, "_position.ps1");
      fs.writeFileSync(psScript, `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32Pos {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  }
"@

Start-Sleep -Seconds 3

$browsers = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and
  ($_.ProcessName -like "*msedge*" -or $_.ProcessName -like "*chrome*") -and
  $_.MainWindowTitle -like "*Nova*"
} | Sort-Object -Property StartTime -Descending

if ($browsers -and $browsers.Count -gt 0) {
  $w = $browsers | Select-Object -First 1
  [Win32Pos]::MoveWindow($w.MainWindowHandle, ${primaryMonitor.x}, ${primaryMonitor.y}, ${primaryMonitor.width}, ${primaryMonitor.height}, $true)
  [Win32Pos]::ShowWindow($w.MainWindowHandle, 3)
  Write-Output "Nova maximized on primary monitor"
} else {
  Write-Output "Nova window not found"
}
`, "utf-8");

      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}"`, (err, stdout) => {
        if (stdout) console.log(`[Nova] ${stdout.trim()}`);
        try { fs.unlinkSync(psScript); } catch {}
      });
    }, 2000);

    console.log("[Nova] Nova launched as standalone app.");
  }
});

console.log("[Nova] All systems starting...");
