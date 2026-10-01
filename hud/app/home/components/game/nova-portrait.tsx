/** Nova the cat (the city's guide), 12x10 pixels: black fur, the Nova suit's cyan visor for eyes, a pink nose. */
const ROWS = [
  "..X......X..",
  ".XXX....XXX.",
  ".XXXXXXXXXX.",
  "XXXXXXXXXXXX",
  "XXCCXXXXCCXX",
  "XXCCXXXXCCXX",
  "XXXXXPPXXXXX",
  "XXXXXXXXXXXX",
  ".XXXXXXXXXX.",
  "..XXXXXXXX..",
] as const

const FILL: Record<string, string> = { X: "#0d0b1c", C: "var(--px-accent-2)", P: "var(--px-pink)" }

export function NovaPortrait({ className }: { className?: string }) {
  return (
    <svg viewBox="-2 -2 16 14" shapeRendering="crispEdges" className={className} aria-hidden="true">
      {ROWS.flatMap((row, y) =>
        [...row].flatMap((cell, x) => (FILL[cell] ? [<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={FILL[cell]} />] : [])),
      )}
    </svg>
  )
}
