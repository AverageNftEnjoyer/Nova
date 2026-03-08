import "server-only"

import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import path from "node:path"

interface DetachedLaunchPlan {
  command: string
  args: string[]
}

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

function getWindowsExecutableCandidates(): string[] {
  const localAppData = String(process.env.LOCALAPPDATA || "").trim()
  const programFiles = String(process.env.ProgramFiles || process.env.PROGRAMFILES || "").trim()
  const programFilesX86 = String(process.env["ProgramFiles(x86)"] || process.env.PROGRAMFILES_X86 || "").trim()
  return [
    localAppData ? path.win32.join(localAppData, "Google", "Chrome", "Application", "chrome.exe") : "",
    programFiles ? path.win32.join(programFiles, "Google", "Chrome", "Application", "chrome.exe") : "",
    programFilesX86 ? path.win32.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe") : "",
    localAppData ? path.win32.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    programFiles ? path.win32.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    programFilesX86 ? path.win32.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe") : "",
  ].filter(Boolean)
}

export function resolveWindowsBrowserLaunchPlans(
  url: string,
  options?: { pathExists?: (candidate: string) => boolean },
): DetachedLaunchPlan[] {
  const target = String(url || "").trim()
  const pathExists = options?.pathExists ?? existsSync
  const plans: DetachedLaunchPlan[] = []
  const seen = new Set<string>()
  for (const executable of getWindowsExecutableCandidates()) {
    const normalized = executable.toLowerCase()
    if (seen.has(normalized) || !pathExists(executable)) continue
    seen.add(normalized)
    plans.push({
      command: executable,
      args: ["--new-window", target],
    })
  }

  const explorerPath = path.win32.join(String(process.env.WINDIR || "C:\\Windows"), "explorer.exe")
  if (!seen.has(explorerPath.toLowerCase()) && pathExists(explorerPath)) {
    plans.push({
      command: explorerPath,
      args: [target],
    })
  }

  const powershellPath = path.win32.join(
    String(process.env.WINDIR || "C:\\Windows"),
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  )
  if (!seen.has(powershellPath.toLowerCase()) && pathExists(powershellPath)) {
    const quotedTarget = quotePowerShellLiteral(target)
    plans.push({
      command: powershellPath,
      args: ["-NoProfile", "-EncodedCommand", encodePowerShell(`$ErrorActionPreference = 'Stop'\nStart-Process ${quotedTarget}`)],
    })
  }

  return plans
}

async function openOnWindows(url: string): Promise<boolean> {
  for (const plan of resolveWindowsBrowserLaunchPlans(url)) {
    if (await spawnDetached(plan.command, plan.args)) {
      return true
    }
  }
  return false
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
