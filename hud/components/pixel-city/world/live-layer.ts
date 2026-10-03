import { Container, Graphics, Sprite, Texture } from "pixi.js"
import {
  CAT_SPOT,
  DISTRICT_PLACES,
  FOUNTAIN,
  HQ_FLOORS,
  HQ_PANEL,
  HQ_SIGN,
  NOTICE_FACE,
} from "../district/image-plan"
import { CAT_CELL, CAT_FOOT_Y, CAT_HEIGHT, CAT_PX, PRESCALE, catSheet } from "../district/people"
import { cellNoise } from "../random"
import type { CityIntegration, CitySceneState, CityTaskLight } from "../types"
import { glyphTexture, rect } from "./textures"

/**
 * The live details drawn from real state: a status lamp on every integration building, U.B Agents HQ's task floors, the
 * noticeboard's papers, the fountain's spray, and U.B Agents the cat. Emissive parts
 * (lamps, HQ lights) are drawn above the night tint so they stay bright after dark; the rest sits with the scene.
 */

const INK = 0x1b1530
const NOVA_CYAN_LIGHT = 0x7ef6ea
const SPRAY = 14

interface Lamp {
  integration: CityIntegration
  on: boolean
  fill: Sprite
  dark: Sprite
  shine: Sprite
  halo: Sprite
  x: number
}

interface FloorLamp {
  slot: Sprite
  lamp: Sprite
}

const TASK_COLOR: Readonly<Record<CityTaskLight, number>> = {
  running: 0x7fffe8,
  queued: 0x8fd4ff,
  paused: 0xffc24a,
  failed: 0xff5a5a,
  completed: 0x58f08c,
}

export class LiveLayer {
  /** Scene-level details (notice board, fountain spray), under the night tint. */
  readonly scene = new Container()
  /** Lamps and HQ lights, above the night tint. */
  readonly emissive = new Container()
  private readonly lamps: Lamp[] = []
  private readonly hqGlow = new Graphics().ellipse(HQ_SIGN.x + HQ_SIGN.w / 2, HQ_SIGN.y + HQ_SIGN.h / 2, HQ_SIGN.w / 2, HQ_SIGN.h / 2).fill({ color: NOVA_CYAN_LIGHT })
  private readonly hqPanel = new Container()
  private readonly floors: FloorLamp[] = []
  private readonly notices = new Container()
  private noticeCount = -1
  private readonly spray: Sprite[] = []
  private readonly cat = new Container()
  private readonly catBody = new Sprite()
  private readonly catAwake: { texture: Texture | null } = { texture: null }
  private readonly catAsleep: { texture: Texture | null } = { texture: null }
  private readonly bubble = new Container()
  private readonly bubbleDots: Sprite[] = []
  private readonly bubbleVoice: Sprite
  private readonly zees: Sprite[] = []
  private state: CitySceneState

  /** `sorted`: the depth-sorted layer that holds the cat. */
  constructor(sorted: Container, state: CitySceneState, private readonly animated: boolean) {
    this.state = state
    this.buildLamps()
    this.buildHq()
    this.scene.addChild(this.notices)
    this.buildSpray()

    this.catBody.anchor.set(0.5, CAT_FOOT_Y / CAT_CELL)
    this.catBody.scale.set(CAT_PX / PRESCALE)
    this.cat.addChild(this.catBody)
    this.cat.position.set(CAT_SPOT.x, CAT_SPOT.y)
    this.cat.zIndex = CAT_SPOT.y
    const top = -CAT_HEIGHT
    this.bubble.addChild(rect(4, top - 9, 14, 9, INK), rect(5, top - 8, 12, 7, 0x2b2547))
    for (let i = 0; i < 3; i++) {
      const dot = rect(7 + i * 3, top - 5, 2, 2, 0xe8e4f8)
      this.bubbleDots.push(dot)
      this.bubble.addChild(dot)
    }
    this.bubbleVoice = rect(10, top - 7, 2, 5, 0xffc24a)
    this.bubble.addChild(this.bubbleVoice)
    this.cat.addChild(this.bubble)
    for (let i = 0; i < 3; i++) {
      const z = new Sprite(glyphTexture("Z", "#1b1530"))
      z.position.set(5 + i * 5, top - 2 - i * 6)
      this.zees.push(z)
      this.cat.addChild(z)
    }
    sorted.addChild(this.cat)
    this.setState(state)
  }

  private buildLamps(): void {
    for (const place of DISTRICT_PLACES) {
      const sign = place.signs[0]
      if (!sign || !place.integration) continue
      const halo = rect(sign.x - 2, sign.y - 2, sign.w + 4, sign.h + 4, 0x3fe27a, 0)
      const border = rect(sign.x, sign.y, sign.w, sign.h, INK)
      const fill = rect(sign.x + 1, sign.y + 1, sign.w - 2, sign.h - 2, 0x6c6a7c)
      const dark = rect(sign.x + 3, sign.y + 3, sign.w - 6, sign.h - 6, 0x3d3b4c)
      const shine = rect(sign.x + 2, sign.y + 2, 2, 2, 0xd6ffe4)
      this.emissive.addChild(border, fill, dark, shine, halo)
      this.lamps.push({ integration: place.integration, on: false, fill, dark, shine, halo, x: sign.x })
    }
  }

  private buildHq(): void {
    this.hqGlow.alpha = 0
    this.emissive.addChild(this.hqGlow)
    const p = HQ_PANEL
    this.hqPanel.addChild(rect(p.x, p.y, p.w, p.h, INK), rect(p.x + 1, p.y + 1, p.w - 2, 1, 0x4a4468))
    for (const r of HQ_FLOORS) {
      const slot = rect(r.x, r.y, r.w, r.h, 0x2c2742)
      const lamp = rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 0xffffff)
      lamp.visible = false
      this.hqPanel.addChild(slot, lamp)
      this.floors.push({ slot, lamp })
    }
    this.hqPanel.visible = false
    this.emissive.addChild(this.hqPanel)
  }

  private buildSpray(): void {
    for (let i = 0; i < SPRAY; i++) {
      const s = rect(0, 0, 1, 1, i % 3 === 0 ? 0xffffff : 0xbff0ff)
      this.spray.push(s)
      this.scene.addChild(s)
    }
  }

  setState(state: CitySceneState): void {
    this.state = state
    const connected = new Set(state.connectedIntegrations)
    for (const lamp of this.lamps) {
      lamp.on = connected.has(lamp.integration)
      lamp.fill.tint = lamp.on ? 0x3fe27a : 0x6c6a7c
      lamp.shine.visible = lamp.on
      lamp.dark.visible = !lamp.on
      if (!lamp.on) lamp.halo.alpha = 0
    }
    this.hqPanel.visible = state.taskLights.length > 0
    this.floors.forEach((floor, i) => {
      const light = state.taskLights[i]
      floor.lamp.visible = !!light
      if (light) floor.lamp.tint = TASK_COLOR[light]
    })
    this.buildNotices(Math.min(6, Math.max(0, state.notesCount)))
  }

  /** A small cork board on two posts: one paper per note (up to six). Always drawn, empty when there are no notes. */
  private buildNotices(count: number): void {
    if (count === this.noticeCount) return
    this.noticeCount = count
    for (const child of this.notices.removeChildren()) child.destroy()
    const f = NOTICE_FACE
    this.notices.addChild(
      rect(f.x + 1, f.y + f.h + 5, f.w, 2, 0x141e32, 0.3),
      rect(f.x + 3, f.y + f.h - 1, 2, 6, 0x5a3a1e),
      rect(f.x + f.w - 5, f.y + f.h - 1, 2, 6, 0x5a3a1e),
      rect(f.x - 1, f.y - 1, f.w + 2, f.h + 2, INK),
      rect(f.x, f.y, f.w, f.h, 0xc8985a),
      rect(f.x, f.y, f.w, 1, 0xe0b87a),
    )
    for (let i = 0; i < count; i++) {
      const x = f.x + 2 + (i % 3) * 10
      const y = f.y + 2 + Math.floor(i / 3) * 9
      this.notices.addChild(
        rect(x, y, 8, 7, 0xfbf6e4),
        rect(x + 1, y + 3, 6, 1, 0x8a8070),
        rect(x + 1, y + 5, 4, 1, 0x8a8070),
        rect(x + 3, y, 2, 2, 0xe03a3a),
      )
    }
  }

  update(t: number): void {
    const motion = this.animated ? t : 0
    for (const lamp of this.lamps) {
      if (lamp.on) lamp.halo.alpha = 0.12 + (0.1 * (Math.sin(motion * 2 + lamp.x) + 1)) / 2
    }
    const running = this.state.taskLights.includes("running")
    this.hqGlow.alpha = running ? 0.14 + (0.12 * (Math.sin(motion * 2.2) + 1)) / 2 : 0
    this.state.taskLights.forEach((light, i) => {
      const floor = this.floors[i]
      if (!floor) return
      if (light === "running") floor.lamp.tint = Math.floor(motion * 3 + i) % 2 === 0 ? 0x7fffe8 : 0xffe9b0
      else if (light === "paused") floor.lamp.tint = Math.floor(motion * 1.5) % 2 === 0 ? 0xffc24a : 0x3a2a10
    })

    if (this.animated) {
      for (let i = 0; i < SPRAY; i++) {
        const phase = (t * 0.9 + cellNoise(i, 0, 61)) % 1
        const side = cellNoise(i, 1, 61) * 2 - 1
        this.spray[i].position.set(Math.round(FOUNTAIN.x + side * 9 * phase), Math.round(FOUNTAIN.y - 14 * Math.sin(phase * Math.PI) + phase * (FOUNTAIN.basinY - FOUNTAIN.y)))
      }
    }

    this.updateCat(motion)
  }

  private catTexture(asleep: boolean): Texture | null {
    const slot = asleep ? this.catAsleep : this.catAwake
    if (slot.texture) return slot.texture
    const canvas = catSheet(asleep)
    if (!canvas) return null
    slot.texture = Texture.from(canvas)
    return slot.texture
  }

  private updateCat(t: number): void {
    const presence = this.state.presence
    // Asleep while U.B Agents is offline; otherwise a short blink every few seconds.
    const eyesShut = presence === "offline" || t % 4.2 < 0.16
    const texture = this.catTexture(eyesShut)
    if (texture && this.catBody.texture !== texture) this.catBody.texture = texture
    this.catBody.visible = !!texture
    const asleep = presence === "offline"
    const zCount = asleep ? 1 + (Math.floor(t * 1.2) % 3) : 0
    this.zees.forEach((z, i) => {
      z.visible = i < zCount
    })
    const thinking = presence === "thinking"
    const speaking = presence === "speaking"
    this.bubble.visible = thinking || speaking
    this.bubbleVoice.visible = speaking
    const dots = 1 + (Math.floor(t * 2.5) % 3)
    this.bubbleDots.forEach((dot, i) => {
      dot.visible = thinking && i < dots
    })
  }
}
