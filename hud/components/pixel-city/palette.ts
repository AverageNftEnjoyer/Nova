import type { CityTimeOfDay } from "./types"

/** A small, fixed palette per time of day: the scene never invents colors, which is what keeps it reading as pixel art. */
export interface CityPalette {
  /** Sky bands from the top down to the horizon. */
  sky: readonly string[]
  star: string
  moon: string
  cloud: string
  cloudShade: string
  ridge: string
  ridgeLight: string
  /** Far-skyline building bodies, back to front. */
  towerFar: readonly string[]
  towerNear: readonly string[]
  towerEdge: string
  /** Lit windows (warm and cool) and their dark counterpart. */
  windowWarm: readonly string[]
  windowCool: string
  windowDark: string
  water: readonly string[]
  waterGlint: string
  pier: string
  pierLight: string
  roof: string
  roofEdge: string
  roofDark: string
  wall: string
  wallDark: string
  wallWindow: string
  metal: string
  metalDark: string
  bamboo: string
  cloth: readonly string[]
  paper: string
  neonPink: string
  neonCyan: string
  neonAmber: string
  /** An unlit neon tube: visible, but clearly off. */
  neonOff: string
  ledGreen: string
  ledRed: string
  ledAmber: string
  ledOff: string
  beacon: string
  rain: string
  snow: string
  fog: string
  cat: string
  catEye: string
  pigeon: string
  ferryHull: string
  ferryDeck: string
  junkHull: string
  junkSail: string
  tram: string
  screen: string
  screenGlow: string
  shadow: string
}

const NIGHT: CityPalette = {
  sky: ["#0a0c24", "#0e1030", "#13143a", "#1a1844", "#241c4e", "#2f2154", "#3d2658", "#4d2b5a"],
  star: "#f4f1d8",
  moon: "#fbf3c8",
  cloud: "#2a2550",
  cloudShade: "#1f1c42",
  ridge: "#12112c",
  ridgeLight: "#1b1a3a",
  towerFar: ["#171a3c", "#1c2046", "#212650"],
  towerNear: ["#262b58", "#2c3263", "#343a6e"],
  towerEdge: "#3f4680",
  windowWarm: ["#ffd88a", "#ffbf5e", "#ffe9b0"],
  windowCool: "#8fd4ff",
  windowDark: "#1a1d3f",
  water: ["#0b0e2a", "#0d1131", "#101538", "#12193f"],
  waterGlint: "#7fa4e8",
  pier: "#2a2238",
  pierLight: "#ffcf7a",
  roof: "#2b2233",
  roofEdge: "#3d3145",
  roofDark: "#1c1622",
  wall: "#3a2a3c",
  wallDark: "#2a1e2c",
  wallWindow: "#ffcf7a",
  metal: "#5b5a70",
  metalDark: "#3a3a4e",
  bamboo: "#8a7a4a",
  cloth: ["#d65a6f", "#5aa0d6", "#e8d9b0", "#7ec48a", "#e89a4f"],
  paper: "#efe6c8",
  neonPink: "#ff4fa0",
  neonCyan: "#3ff2ff",
  neonAmber: "#ffb13b",
  neonOff: "#4d2a52",
  ledGreen: "#58f08c",
  ledRed: "#ff5a5a",
  ledAmber: "#ffc24a",
  ledOff: "#2a2a3a",
  beacon: "#ff4a4a",
  rain: "rgba(170, 190, 255, 0.55)",
  snow: "#eef2ff",
  fog: "rgba(120, 110, 160, 0.18)",
  cat: "#0d0a12",
  catEye: "#b8ff6a",
  pigeon: "#6b6a80",
  ferryHull: "#1f7a4a",
  ferryDeck: "#e8ecf0",
  junkHull: "#4a2a1c",
  junkSail: "#c2362e",
  tram: "#b33a2e",
  screen: "#141a2e",
  screenGlow: "#ff3355",
  shadow: "rgba(0, 0, 0, 0.35)",
}

const DAY: CityPalette = {
  sky: ["#4f9ee0", "#5ba8e6", "#68b2ea", "#77bdee", "#88c7f1", "#9bd1f3", "#b0dbf5", "#c6e5f6"],
  star: "#ffffff",
  moon: "#fff6d0",
  cloud: "#ffffff",
  cloudShade: "#dcebf6",
  ridge: "#4f7a6a",
  ridgeLight: "#628e7a",
  towerFar: ["#9fb3cf", "#a9bdd8", "#b4c6de"],
  towerNear: ["#8499b8", "#90a4c2", "#9db0cc"],
  towerEdge: "#c9d8ec",
  windowWarm: ["#dff1ff", "#c9e6ff", "#eef8ff"],
  windowCool: "#bfe0ff",
  windowDark: "#7b90b0",
  water: ["#2f78b4", "#3582bd", "#3b8cc4", "#4196cb"],
  waterGlint: "#e8f6ff",
  pier: "#7a6a58",
  pierLight: "#f4d9a0",
  roof: "#8a7466",
  roofEdge: "#a08878",
  roofDark: "#6a584c",
  wall: "#b0907a",
  wallDark: "#94766a",
  wallWindow: "#5a7a96",
  metal: "#9aa0ae",
  metalDark: "#737888",
  bamboo: "#c2a868",
  cloth: ["#e0566e", "#4f94d4", "#f6ecd0", "#6cc47e", "#f0a050"],
  paper: "#fffaf0",
  neonPink: "#e84b90",
  neonCyan: "#2ec8d8",
  neonAmber: "#f0a030",
  neonOff: "#9a7a92",
  ledGreen: "#30c070",
  ledRed: "#e04444",
  ledAmber: "#e8a830",
  ledOff: "#5a5e6a",
  beacon: "#e04444",
  rain: "rgba(90, 110, 150, 0.5)",
  snow: "#ffffff",
  fog: "rgba(230, 236, 245, 0.35)",
  cat: "#2a2228",
  catEye: "#a8e060",
  pigeon: "#8c8ca0",
  ferryHull: "#1f8a52",
  ferryDeck: "#ffffff",
  junkHull: "#5a3422",
  junkSail: "#d2402f",
  tram: "#c8453a",
  screen: "#2a3246",
  screenGlow: "#ff3355",
  shadow: "rgba(40, 30, 60, 0.22)",
}

export function paletteFor(timeOfDay: CityTimeOfDay): CityPalette {
  return timeOfDay === "day" ? DAY : NIGHT
}
