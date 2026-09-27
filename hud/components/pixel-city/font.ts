/** 3x5 bitmap font for text painted inside the scene (billboard ticker, LED meter, neon signs). */

const GLYPHS: Readonly<Record<string, string>> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
  E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100",
  Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111",
  "0": "111101101101111", "1": "010110010010111", "2": "110001010100111", "3": "110001010001110",
  "4": "101101111001001", "5": "111100110001110", "6": "011100111101111", "7": "111001010010010",
  "8": "111101111101111", "9": "111101111001110",
  $: "011110010011110", ".": "000000000000010", ",": "000000000010100", "%": "101001010100101",
  "+": "000010111010000", "-": "000000111000000", ":": "000010000010000", "/": "001001010100100",
  "?": "110001010000010", "!": "010010010000010", "·": "000000010000000", " ": "000000000000000",
}

export const GLYPH_WIDTH = 3
export const GLYPH_HEIGHT = 5
/** Advance per character: glyph plus one pixel of spacing. */
export const GLYPH_ADVANCE = 4

/** Row-major bit string of one glyph (unknown characters render as "?"). */
export function glyphBits(ch: string): string {
  return GLYPHS[ch.toUpperCase()] ?? GLYPHS["?"]
}

export function measureText(text: string): number {
  return Math.max(0, text.length * GLYPH_ADVANCE - 1)
}

/** Paints text with fillRect so it stays crisp at the scene's 1:1 logical resolution. */
export function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  clip?: { x0: number; x1: number },
): void {
  ctx.fillStyle = color
  const upper = text.toUpperCase()
  for (let i = 0; i < upper.length; i++) {
    const gx = Math.round(x + i * GLYPH_ADVANCE)
    if (clip && (gx + GLYPH_WIDTH < clip.x0 || gx > clip.x1)) continue
    const bits = GLYPHS[upper[i]] ?? GLYPHS["?"]
    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      for (let col = 0; col < GLYPH_WIDTH; col++) {
        if (bits[row * GLYPH_WIDTH + col] !== "1") continue
        const px = gx + col
        if (clip && (px < clip.x0 || px > clip.x1)) continue
        ctx.fillRect(px, Math.round(y) + row, 1, 1)
      }
    }
  }
}
