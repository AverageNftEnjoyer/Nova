import { Application, Container, Graphics, Rectangle, type Ticker } from "pixi.js"
import { Viewport } from "pixi-viewport"
import { CitySim } from "../district/city-sim"
import { DISTRICT_MAP, DISTRICT_PLACES, DISTRICT_SEA_COLOR } from "../district/image-plan"
import { loadPeopleArt } from "../district/people"
import { clampCamera, fromView, initialCamera, panBy, revealRect, toView, zoomAround, zoomLimits, type Camera, type CameraView } from "../scene-camera"
import type { CityPlaceId, CityRect, CityResidentAnchor, CitySceneHit, CitySceneState } from "../types"
import { AmbientLayer } from "./ambient-layer"
import { DayNightLayer } from "./day-night-layer"
import { LiveLayer } from "./live-layer"
import { buildMapSprites, buildOccluders, loadMapImage, sampleWaterCells } from "./map-layer"
import { PeopleLayer } from "./people-layer"
import { parseTimeOfDay, setCityTimeOfDay } from "./time-of-day"
import { WeatherLayer } from "./weather-layer"
import type { CityWorld, CreateCityWorldOptions } from "./world-types"

/**
 * U.B Agents City as a PixiJS (WebGL) world with a pixi-viewport camera. The plan's pixels are the world's units, so every
 * rectangle, walk node and occluder in image-plan.ts is used unchanged; the map is positioned from DISTRICT_MAP and is
 * the only thing that knows the art's size. Layers, back to front:
 *   map, water glints + waterfalls, notice board + fountain, agent trails,
 *   [depth-sorted by feet y: structure cut-outs, walkers, U.B Agents the cat],
 *   cloud shadows, day/night tint (multiply), window lights (additive), lamps + HQ lights, status badges, weather, hover.
 * The scene component keeps hotspots, residents and controls as real DOM buttons positioned from `getView()`.
 */

const GLIDE_MIN_MS = 480
const GLIDE_MAX_MS = 700
const NUDGE_MS = 240
const HOVER_FADE_PER_SECOND = 14
const REDUCED_MOTION_MAX_FPS = 30
const INK = 0x1b1530
const NOVA_CYAN = 0x12c9b8

const placeRects: Partial<Record<CityPlaceId, CityRect>> = Object.fromEntries(DISTRICT_PLACES.map((place) => [place.id, place.hit]))

/** Outline the building under the pointer: a soft fill, an ink-and-white pixel border and teal corner ticks. */
class HoverMarker {
  readonly graphics = new Graphics()
  private target = 0

  constructor(private readonly instant: boolean) {
    this.graphics.alpha = 0
    this.graphics.visible = false
  }

  set(id: CityPlaceId | null): void {
    const r = id ? placeRects[id] : undefined
    this.target = r ? 1 : 0
    if (!r) return
    const g = this.graphics
    g.clear()
    g.rect(r.x, r.y, r.w, r.h).fill({ color: 0xffffff, alpha: 0.1 })
    g.rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2).stroke({ width: 1, color: INK, alpha: 0.55 })
    g.rect(r.x, r.y, r.w, r.h).stroke({ width: 1.5, color: 0xffffff, alpha: 0.95 })
    const tick = Math.min(8, r.w / 3, r.h / 3)
    for (const [cx, cy, sx, sy] of [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]] as const) {
      g.moveTo(cx + sx * tick, cy).lineTo(cx, cy).lineTo(cx, cy + sy * tick).stroke({ width: 2, color: NOVA_CYAN })
    }
    if (this.instant) this.graphics.alpha = 1
    this.graphics.visible = true
  }

  update(dt: number): void {
    const g = this.graphics
    if (!g.visible) return
    g.alpha = this.instant ? this.target : g.alpha + (this.target - g.alpha) * Math.min(1, dt * HOVER_FADE_PER_SECOND)
    if (this.target === 0 && g.alpha < 0.01) {
      g.alpha = 0
      g.visible = false
    }
  }
}

function sameView(a: CameraView | null, b: CameraView): boolean {
  return !!a && a.zoom === b.zoom && a.offsetX === b.offsetX && a.offsetY === b.offsetY
}

export async function createCityWorld(options: CreateCityWorldOptions): Promise<CityWorld> {
  const { host, reducedMotion } = options
  const forcedHour = parseTimeOfDay(new URLSearchParams(window.location.search).get("tod"))
  if (forcedHour !== null) setCityTimeOfDay(forcedHour)

  loadPeopleArt()
  const imagePromise = loadMapImage(DISTRICT_MAP.src)

  let vp = options.viewport
  const app = new Application()
  await app.init({
    width: vp.width,
    height: vp.height,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    antialias: false,
    backgroundColor: DISTRICT_SEA_COLOR,
    preference: ["webgl"], // no canvas fallback: without WebGL the scene shows the static map instead
    powerPreference: "high-performance",
    autoStart: false,
  })
  const image = await imagePromise
  options.onBoot?.("map")

  const canvas = app.canvas
  canvas.setAttribute("aria-hidden", "true")
  canvas.style.position = "absolute"
  canvas.style.inset = "0"
  host.prepend(canvas)

  // Pointer events are listened for on the host, so a drag that starts on a building's button still pans. Pixi maps
  // pointer positions with the target's width/height (a canvas has them; a div does not), so the host borrows the
  // canvas's.
  const events = app.renderer.events
  events.autoPreventDefault = false
  const hostWidth = () => canvas.width
  const hostHeight = () => canvas.height
  Object.defineProperty(host, "width", { configurable: true, get: hostWidth })
  Object.defineProperty(host, "height", { configurable: true, get: hostHeight })
  events.setTargetElement(host)

  const gl = "gl" in app.renderer ? (app.renderer as { gl: WebGL2RenderingContext }).gl : null
  const maxTextureSize = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096 : 4096

  const viewport = new Viewport({
    screenWidth: vp.width,
    screenHeight: vp.height,
    worldWidth: DISTRICT_MAP.w,
    worldHeight: DISTRICT_MAP.h,
    events,
    ticker: app.ticker,
    threshold: 6,
    passiveWheel: false,
    disableOnContextMenu: true,
    allowPreserveDragOutside: true,
    forceHitArea: new Rectangle(DISTRICT_MAP.x, DISTRICT_MAP.y, DISTRICT_MAP.w, DISTRICT_MAP.h),
  })
  app.stage.addChild(viewport)

  const configureLimits = () => {
    const limits = zoomLimits(vp)
    viewport.clampZoom({ minScale: limits.min, maxScale: limits.max })
  }
  viewport.drag().pinch().wheel({ smooth: 4, percent: 0.12, trackpadPinch: false })
  if (!reducedMotion) viewport.decelerate({ friction: 0.92, minSpeed: 0.02 })
  configureLimits()
  viewport.clamp({ left: DISTRICT_MAP.x, right: DISTRICT_MAP.x + DISTRICT_MAP.w, top: DISTRICT_MAP.y, bottom: DISTRICT_MAP.y + DISTRICT_MAP.h, underflow: "center" })

  // ── Layers ────────────────────────────────────────────────────────────────────
  const animated = !reducedMotion
  const sim = new CitySim()
  const mapSprites = buildMapSprites(image, maxTextureSize)
  const ambient = new AmbientLayer(sampleWaterCells(image), animated)
  const sorted = new Container()
  sorted.sortableChildren = true
  const trails = new Container()
  const badges = new Container()
  const live = new LiveLayer(sorted, options.state, animated)
  const people = new PeopleLayer(sorted, trails, badges, animated)
  const dayNight = new DayNightLayer(animated)
  const weather = new WeatherLayer(animated)
  const hover = new HoverMarker(reducedMotion)
  for (const occluder of buildOccluders(image)) {
    occluder.sprite.zIndex = occluder.baseY - 0.5
    sorted.addChild(occluder.sprite)
  }
  viewport.addChild(
    mapSprites,
    ambient.ground,
    live.scene,
    trails,
    sorted,
    ambient.clouds,
    dayNight.tint,
    dayNight.lights,
    live.emissive,
    badges,
    weather.container,
    hover.graphics,
  )

  // ── Camera ────────────────────────────────────────────────────────────────────
  const viewOf = (): CameraView => ({ zoom: viewport.scale.x, offsetX: viewport.x, offsetY: viewport.y })
  const cameraOf = (): Camera => fromView(viewOf(), vp)
  /** The world point at the screen's centre for a camera (which is defined at the centre of the safe area). */
  const centreOf = (cam: Camera) => {
    const v = toView(cam, vp)
    return { x: (vp.width / 2 - v.offsetX) / v.zoom, y: (vp.height / 2 - v.offsetY) / v.zoom }
  }
  const jumpTo = (cam: Camera) => {
    const clamped = clampCamera(cam, vp)
    viewport.scale.set(clamped.zoom)
    const c = centreOf(clamped)
    viewport.moveCenter(c.x, c.y)
  }

  let glideToken = 0
  const animateTo = (cam: Camera, time: number, ease: string, onDone?: () => void) => {
    const token = ++glideToken
    const target = clampCamera(cam, vp)
    if (reducedMotion) {
      jumpTo(target)
      onDone?.()
      return
    }
    viewport.animate({
      time,
      position: centreOf(target),
      scale: target.zoom,
      ease,
      removeOnInterrupt: true,
      callbackOnComplete: () => {
        if (token === glideToken) onDone?.()
      },
    })
  }

  jumpTo(options.initialCamera(vp))

  // ── Frame ─────────────────────────────────────────────────────────────────────
  let lastView: CameraView | null = null
  let active = options.active
  let ready = false

  const emitView = () => {
    const view = viewOf()
    if (sameView(lastView, view)) return
    lastView = view
    options.onView(view)
  }

  const frame = (t: number, dt: number) => {
    sim.step(t)
    people.update(sim, t)
    live.update(t)
    const cam = cameraOf()
    ambient.update(t, dt, cam.cx, cam.cy)
    dayNight.update(t)
    weather.update(t)
    hover.update(dt)
    emitView()
    options.onFrame()
  }

  const tick = (ticker: Ticker) => {
    frame(ticker.lastTime / 1000, Math.min(0.1, ticker.deltaMS / 1000))
  }
  app.ticker.add(tick)
  if (reducedMotion) app.ticker.maxFPS = REDUCED_MOTION_MAX_FPS

  const syncTicker = () => {
    if (active && !document.hidden) app.ticker.start()
    else app.ticker.stop()
  }
  document.addEventListener("visibilitychange", syncTicker)

  /** One frame outside the ticker: used while the world is parked, so state and size changes still show. */
  const renderOnce = () => {
    if (!ready || app.ticker.started) return
    frame(performance.now() / 1000, 0)
    app.render()
  }

  const world: CityWorld = {
    setState(state: CitySceneState) {
      sim.setState(state)
      live.setState(state)
      weather.setWeather(state.weather)
      ambient.setWeather(state.weather)
      renderOnce()
    },
    hotspots: () => sim.hotspots(),
    hitTest: (x, y): CitySceneHit | null => sim.hitTest(x, y),
    residents: (): CityResidentAnchor[] => sim.residents(),
    setHover(id) {
      hover.set(id)
      renderOnce()
    },
    setActive(next) {
      active = next
      syncTicker()
    },
    resize(next) {
      const before = ready ? cameraOf() : null
      vp = next
      app.renderer.resize(vp.width, vp.height)
      viewport.resize(vp.width, vp.height, DISTRICT_MAP.w, DISTRICT_MAP.h)
      configureLimits()
      jumpTo(before ?? options.initialCamera(vp))
      emitView()
      renderOnce()
    },
    getView: viewOf,
    getCamera: cameraOf,
    zoomBy(factor) {
      animateTo(zoomAround(cameraOf(), factor, vp.width / 2, vp.safeTop + (vp.height - vp.safeTop - vp.safeBottom) / 2, vp), NUDGE_MS, "easeOutCubic")
    },
    panBy(dx, dy) {
      animateTo(panBy(cameraOf(), dx, dy, vp), NUDGE_MS, "easeOutCubic")
    },
    recenter() {
      animateTo(initialCamera(vp), GLIDE_MIN_MS, "easeInOutSine")
    },
    revealRect(rect) {
      const next = revealRect(cameraOf(), rect, vp)
      if (next) animateTo(next, NUDGE_MS * 1.5, "easeOutCubic")
    },
    glideToRect(rect, onArrive) {
      const cam = cameraOf()
      const target = clampCamera({ zoom: cam.zoom, cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 }, vp)
      const distance = Math.hypot((target.cx - cam.cx) * cam.zoom, (target.cy - cam.cy) * cam.zoom)
      if (distance < 6) {
        glideToken++
        onArrive()
        return
      }
      animateTo(target, Math.round(Math.min(GLIDE_MAX_MS, GLIDE_MIN_MS + distance * 0.3)), "easeInOutSine", onArrive)
    },
    destroy() {
      document.removeEventListener("visibilitychange", syncTicker)
      app.ticker.remove(tick)
      app.ticker.stop()
      people.destroy()
      // Another world may already own the host again (React re-mounts the scene in development): leave its getters.
      if (Object.getOwnPropertyDescriptor(host, "width")?.get === hostWidth) delete (host as { width?: number }).width
      if (Object.getOwnPropertyDescriptor(host, "height")?.get === hostHeight) delete (host as { height?: number }).height
      app.destroy(true, { children: true })
    },
  }

  world.setState(options.state)
  frame(performance.now() / 1000, 0)
  app.render()
  ready = true
  syncTicker()
  return world
}
