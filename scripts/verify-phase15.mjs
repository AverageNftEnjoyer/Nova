import { spawnSync } from "node:child_process";

const npmExecPath = String(process.env.npm_execpath || "").trim();
const child = npmExecPath
  ? spawnSync(process.execPath, [npmExecPath, "run", "smoke:src-release"], {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: true,
    })
  : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "smoke:src-release"], {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: true,
      shell: true,
    });

if (typeof child.status === "number") process.exit(child.status);
process.exit(1);
