import fs from "fs/promises"
import path from "path"

const SETTINGS_FILE = path.resolve(process.cwd(), "..", "nova-settings.json")

type NovaSettings = {
  bootMusicMuted?: boolean
}

async function readSettings(): Promise<NovaSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf-8")
    return JSON.parse(raw) as NovaSettings
  } catch {
    return {}
  }
}

async function writeSettings(next: NovaSettings) {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf-8")
}

export async function GET() {
  const settings = await readSettings()
  return Response.json({ muted: settings.bootMusicMuted === true })
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { muted?: unknown }
    if (typeof body.muted !== "boolean") {
      return Response.json({ error: "Invalid payload: muted must be boolean" }, { status: 400 })
    }

    const current = await readSettings()
    const next = { ...current, bootMusicMuted: body.muted }
    await writeSettings(next)
    return Response.json({ muted: next.bootMusicMuted === true })
  } catch {
    return Response.json({ error: "Failed to update boot music setting" }, { status: 500 })
  }
}
