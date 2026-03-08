import assert from "node:assert/strict"
import test from "node:test"

import { resolveWindowsBrowserLaunchPlans } from "../external-browser.ts"

test("phantom external browser launcher prefers installed Chrome and falls back to explorer on Windows", () => {
  const originalEnv = {
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    ProgramFiles: process.env.ProgramFiles,
    "ProgramFiles(x86)": process.env["ProgramFiles(x86)"],
    WINDIR: process.env.WINDIR,
  }

  process.env.LOCALAPPDATA = "C:\\Users\\Test\\AppData\\Local"
  process.env.ProgramFiles = "C:\\Program Files"
  process.env["ProgramFiles(x86)"] = "C:\\Program Files (x86)"
  process.env.WINDIR = "C:\\Windows"

  try {
    const existingPaths = new Set([
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Windows\\explorer.exe",
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    ])
    const plans = resolveWindowsBrowserLaunchPlans("http://localhost:3000/integrations?setup=phantom", {
      pathExists: (candidate) => existingPaths.has(candidate),
    })
    assert.ok(plans.length >= 1)
    assert.equal(plans[0]?.command, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    assert.deepEqual(plans[0]?.args, ["--new-window", "http://localhost:3000/integrations?setup=phantom"])
    assert.ok(plans.some((plan) => plan.command === "C:\\Windows\\explorer.exe"))
  } finally {
    process.env.LOCALAPPDATA = originalEnv.LOCALAPPDATA
    process.env.ProgramFiles = originalEnv.ProgramFiles
    process.env["ProgramFiles(x86)"] = originalEnv["ProgramFiles(x86)"]
    process.env.WINDIR = originalEnv.WINDIR
  }
})
