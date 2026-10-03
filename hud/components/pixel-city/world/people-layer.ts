import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js"
import { APPEAR_SECONDS, drawnX, drawnY, type CitySim, type Walker } from "../district/city-sim"
import { CELL, FOOT_Y, PERSON_HEIGHT, PERSON_PX, PRESCALE, WALK_FPS, WALK_FRAMES, agentLook, peopleSheet, type PersonSheet } from "../district/people"
import { ellipseTexture, glyphTexture, rect } from "./textures"

/**
 * Draws the simulation's walkers: a sheet frame, a contact shadow, and for agents the pulsing ground ring, the data
 * trail and the status badge. Figures live in the depth-sorted layer with `zIndex` = their feet's y, so they pass in
 * front of and behind the cat, boats and structure cut-outs (map-layer.ts) correctly. Views are created and removed as
 * walkers come and go; nothing is allocated per frame.
 */

const NOVA_CYAN = 0x12c9b8
const INK = 0x1b1530
const TRAIL_LENGTH = 12
const SHEET_COLUMNS = 1 + WALK_FRAMES
const SHEET_ROWS = 8

interface WalkerView {
  root: Container
  body: Sprite
  ring: Graphics | null
  trail: Sprite[] | null
  badge: Container | null
  badgeGlyph: Sprite | null
  badgeKey: string
  frameKey: number
  sheet: PersonSheet | null
  seen: number
}

const BADGES = {
  paused: { char: "!", color: "#ffc24a", dx: -1 },
  failed: { char: "X", color: "#ff6a6a", dx: -1 },
  queued: { char: ".", color: "#8fd4ff", dx: 1 },
} as const

export class PeopleLayer {
  private readonly views = new Map<Walker, WalkerView>()
  private readonly frames = new Map<PersonSheet, Texture[]>()
  private frameId = 0

  /**
   * @param sorted depth-sorted layer for the figures
   * @param trails ground layer for agent data trails
   * @param badges top layer for status badges
   */
  constructor(
    private readonly sorted: Container,
    private readonly trails: Container,
    private readonly badges: Container,
    private readonly animated: boolean,
  ) {}

  /** The 7 x 8 frame textures of a sheet, once its image has loaded. Index: row * SHEET_COLUMNS + col. */
  private sheetFrames(sheet: PersonSheet): Texture[] | null {
    const cached = this.frames.get(sheet)
    if (cached) return cached
    const canvas = peopleSheet(sheet)
    if (!canvas) return null
    const base = Texture.from(canvas)
    const size = CELL * PRESCALE
    const list: Texture[] = []
    for (let row = 0; row < SHEET_ROWS; row++) {
      for (let col = 0; col < SHEET_COLUMNS; col++) {
        list.push(new Texture({ source: base.source, frame: new Rectangle(col * size, row * size, size, size) }))
      }
    }
    this.frames.set(sheet, list)
    return list
  }

  private createView(w: Walker): WalkerView {
    const root = new Container()
    const shadow = new Sprite(ellipseTexture())
    shadow.anchor.set(0.5)
    shadow.tint = 0x141e32
    shadow.alpha = 0.3
    shadow.width = 10
    shadow.height = 4
    shadow.y = -1
    const body = new Sprite()
    body.anchor.set(0.5, FOOT_Y / CELL)
    body.scale.set(PERSON_PX / PRESCALE)
    body.visible = false
    let ring: Graphics | null = null
    let trail: Sprite[] | null = null
    let badge: Container | null = null
    let badgeGlyph: Sprite | null = null
    if (w.kind === "agent") {
      ring = new Graphics().ellipse(0, -1, 7, 3).stroke({ width: 1.2, color: NOVA_CYAN })
      root.addChild(ring)
      trail = []
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        const dot = rect(0, 0, 1, 1, NOVA_CYAN)
        dot.visible = false
        trail.push(dot)
        this.trails.addChild(dot)
      }
      badge = new Container()
      badgeGlyph = new Sprite(glyphTexture("!", "#ffc24a"))
      badge.addChild(rect(-5, -1, 11, 11, INK), rect(-4, 0, 9, 9, 0x2b2547), rect(-4, 0, 9, 1, NOVA_CYAN), badgeGlyph)
      badge.visible = false
      this.badges.addChild(badge)
    }
    root.addChild(shadow, body)
    this.sorted.addChild(root)
    return { root, body, ring, trail, badge, badgeGlyph, badgeKey: "", frameKey: -1, sheet: null, seen: 0 }
  }

  private removeView(w: Walker, view: WalkerView): void {
    view.root.destroy({ children: true })
    view.trail?.forEach((dot) => dot.destroy())
    view.badge?.destroy({ children: true })
    this.views.delete(w)
  }

  update(sim: CitySim, t: number): void {
    this.frameId++
    const motion = this.animated ? t : 0
    for (const w of sim.walkers) {
      let view = this.views.get(w)
      if (!view) {
        view = this.createView(w)
        this.views.set(w, view)
      }
      view.seen = this.frameId
      const x = drawnX(w)
      const y = drawnY(w)
      const fadeOut = w.fade !== undefined ? Math.max(0, 1 - (t - w.fade) / 2) : 1
      const fadeIn = w.appear === undefined ? 1 : Number.isNaN(w.appear) ? 0 : Math.min(1, Math.max(0, (t - w.appear) / APPEAR_SECONDS))
      const alpha = Math.min(fadeOut, fadeIn)
      view.root.position.set(x, y)
      view.root.zIndex = y
      view.root.alpha = alpha

      const sheet = (w.worker ? agentLook(w.worker.workplace) : agentLook(w.agent?.workplace ?? "hq")).sheet
      const frames = this.sheetFrames(sheet)
      if (frames) {
        const row = ((Math.round(w.dir) % 8) + 8) % 8
        const col = w.moving ? 1 + (Math.floor(motion * WALK_FPS + x * 0.37) % WALK_FRAMES) : 0
        const key = row * SHEET_COLUMNS + col
        if (key !== view.frameKey || sheet !== view.sheet) {
          view.body.texture = frames[key]
          view.frameKey = key
          view.sheet = sheet
        }
        view.body.visible = true
      }

      if (view.ring) view.ring.alpha = 0.28 + ((Math.sin(motion * 3 + x) + 1) / 2) * 0.2
      if (view.trail) {
        const trail = w.moving ? (w.trail ?? []) : []
        for (let i = 0; i < TRAIL_LENGTH; i++) {
          const dot = view.trail[i]
          const p = trail[i]
          dot.visible = !!p
          if (!p) continue
          dot.position.set(Math.round(p.x), Math.round(p.y))
          dot.alpha = alpha * ((i + 1) / trail.length) * 0.6
        }
      }
      if (view.badge && view.badgeGlyph) {
        const a = w.agent
        const status = a && !w.moving && !w.leaving && alpha > 0.2 ? a.status : null
        const spec = status === "paused" || status === "failed" || status === "queued" ? BADGES[status] : null
        view.badge.visible = !!spec
        if (spec) {
          if (view.badgeKey !== status) {
            view.badgeKey = status ?? ""
            view.badgeGlyph.texture = glyphTexture(spec.char, spec.color)
            view.badgeGlyph.position.set(spec.dx, 2)
          }
          view.badge.position.set(x, y - PERSON_HEIGHT - 10 + Math.round(Math.sin(motion * 2.4 + x)))
        }
      }
    }
    if (this.views.size > sim.walkers.length) {
      for (const [w, view] of this.views) if (view.seen !== this.frameId) this.removeView(w, view)
    }
  }

  destroy(): void {
    for (const [w, view] of this.views) this.removeView(w, view)
  }
}
