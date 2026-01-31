import { spawn, exec } from "child_process";
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

// ===== 1. Play bootup sound (30 seconds) =====
const mpv = path.join(__dirname, "agent", "mpv", "mpv.exe");
const bootSound = path.join(__dirname, "hud", "public", "sounds", "hth.mp3");

const bootAudio = spawn(mpv, [
  bootSound,
  "--no-video",
  "--really-quiet",
  "--keep-open=no",
  `--end=26`,
  `--volume=413`,
]);
bootAudio.on("exit", () => console.log("[Nova] Boot sound finished."));

console.log("[Nova] Boot sequence started.");

// ===== 2. Start the AI agent =====
launch("Agent", "node", ["agent.js"], path.join(__dirname, "agent"));

// ===== 3. Start the HUD dev server =====
const hud = launch("HUD", "npm", ["run", "dev"], path.join(__dirname, "hud"));

// ===== 4. Open the HUD in the default browser once it's ready =====
hud.stdout.on("data", (chunk) => {
  if (chunk.toString().includes("Ready")) {
    exec("start http://localhost:3000");
    console.log("[Nova] HUD opened in browser.");
  }
});

console.log("[Nova] All systems starting...");
