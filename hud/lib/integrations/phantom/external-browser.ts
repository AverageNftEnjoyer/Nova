import "server-only"

import { spawn } from "node:child_process"

function spawnDetached(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        shell: false,
        windowsHide: true,
      })
      child.once("error", () => resolve(false))
      child.once("spawn", () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64")
}

function quotePowerShellLiteral(value: string): string {
  return `'${String(value || "").replace(/'/g, "''")}'`
}

async function openOnWindows(url: string): Promise<boolean> {
  const target = quotePowerShellLiteral(url)
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `try { Start-Process chrome.exe ${target} } catch { Start-Process ${target} }`,
  ].join("\n")
  return spawnDetached("powershell", ["-NoProfile", "-EncodedCommand", encodePowerShell(script)])
}

async function openOnMac(url: string): Promise<boolean> {
  return (await spawnDetached("open", ["-a", "Google Chrome", url])) || spawnDetached("open", [url])
}

async function openOnLinux(url: string): Promise<boolean> {
  return (await spawnDetached("google-chrome", [url])) || spawnDetached("xdg-open", [url])
}

export async function openExternalBrowser(url: string): Promise<boolean> {
  const target = String(url || "").trim()
  if (!/^https?:\/\//i.test(target)) return false
  if (process.platform === "win32") return openOnWindows(target)
  if (process.platform === "darwin") return openOnMac(target)
  return openOnLinux(target)
}
