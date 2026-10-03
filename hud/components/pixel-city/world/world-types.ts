import type { CityBootPhase } from "../boot"
import type { Camera, CameraView, CameraViewport } from "../scene-camera"
import type { CityRect, CitySceneRenderer, CitySceneState } from "../types"

/** What the scene component drives: the data-side renderer interface plus the camera. */
export interface CityWorld extends CitySceneRenderer {
  /** The window changed size or its safe bands moved: re-fit the renderer and keep the camera valid. */
  resize(viewport: CameraViewport): void
  /** Where the plan's origin is on screen and at what zoom: what the DOM overlay is positioned from. */
  getView(): CameraView
  getCamera(): Camera
  /** Zoom by `factor` about the centre of the safe area (eased). */
  zoomBy(factor: number): void
  /** Pan by screen pixels (eased). Positive `dx` moves the map right. */
  panBy(dx: number, dy: number): void
  /** The default framing. */
  recenter(): void
  /** Eases the camera just enough to bring `rect` (plan pixels) fully into the safe area; no-op when already visible. */
  revealRect(rect: CityRect): void
  /** Glides to centre `rect`, then calls `onArrive` (at once if reduced motion or already centred). Any user input cancels the glide and the call. */
  glideToRect(rect: CityRect, onArrive: () => void): void
}

export interface CreateCityWorldOptions {
  host: HTMLElement
  /** The host's measured size and HUD bands. */
  viewport: CameraViewport
  state: CitySceneState
  active: boolean
  reducedMotion: boolean
  /** The camera the world opens with, for the first window (stored or default). */
  initialCamera: (viewport: CameraViewport) => Camera
  /** The view changed (drag, zoom, glide, resize): reposition the DOM overlay. */
  onView: (view: CameraView) => void
  /** After every drawn frame (residents moved): reposition the resident buttons. */
  onFrame: () => void
  /** The map image is decoded and the world is about to build it. Home's boot screen listens. */
  onBoot?: (phase: CityBootPhase) => void
}
