export type Orb3DPalette = {
  core: string
  filament: string
  ring: string
  spark: string
  accent: string
  shell: string
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "")
  const full = normalized.length === 3 ? normalized.split("").map((char) => `${char}${char}`).join("") : normalized
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 255, g: 196, b: 96 }
  const num = Number.parseInt(full, 16)
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  const x = clamp01(t)
  const r = Math.round(ca.r + (cb.r - ca.r) * x)
  const g = Math.round(ca.g + (cb.g - ca.g) * x)
  const bl = Math.round(ca.b + (cb.b - ca.b) * x)
  return `#${[r, g, bl].map((value) => value.toString(16).padStart(2, "0")).join("")}`
}

/**
 * Build the 3D orb palette directly from the user's chosen orb color.
 * All derived tones are blended from the selected orb palette only.
 */
export function buildOrb3DPalette(orbPalette: {
  circle1: string
  circle2: string
  circle3: string
  circle4: string
  circle5: string
}): Orb3DPalette {
  return {
    core: mixHex(orbPalette.circle1, orbPalette.circle2, 0.34),
    filament: mixHex(orbPalette.circle2, orbPalette.circle4, 0.36),
    ring: mixHex(orbPalette.circle1, orbPalette.circle3, 0.40),
    spark: mixHex(orbPalette.circle4, orbPalette.circle5, 0.46),
    accent: mixHex(orbPalette.circle5, orbPalette.circle2, 0.28),
    shell: mixHex(orbPalette.circle1, orbPalette.circle4, 0.50),
  }
}
