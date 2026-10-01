"use client"

import { cosmeticUrl, personSheetArt, useCosmeticStatus, type PersonSheetId } from "@/components/pixel-city"
import { cn } from "@/lib/shared/utils"

interface CosmeticPreviewProps {
  /** The default body: the resident's job sheet, drawn when no outfit is worn or its art does not exist yet. */
  sheet: PersonSheetId
  outfit?: string
  hat?: string
  /** Screen pixels per art pixel (a cell is 32 art pixels). */
  scale: number
  /** Accessible description of what is shown. */
  label: string
  className?: string
}

/**
 * One resident's standing, south-facing frame with the outfit and hat layered on, drawn with hard pixel edges. The
 * same fallback the city uses: a cosmetic whose sheet is missing (or still loading) is skipped, so the preview always
 * shows what the city would draw.
 */
export function CosmeticPreview({ sheet, outfit, hat, scale, label, className }: CosmeticPreviewProps) {
  const outfitStatus = useCosmeticStatus(outfit)
  const hatStatus = useCosmeticStatus(hat)
  const base = personSheetArt(sheet)
  const size = base.cell * scale
  const layer = (url: string) => ({
    position: "absolute" as const,
    inset: 0,
    backgroundImage: `url(${url})`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "0 0",
    backgroundSize: `${base.columns * size}px ${base.rows * size}px`,
    imageRendering: "pixelated" as const,
  })
  return (
    <div role="img" aria-label={label} className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <div style={layer(outfit && outfitStatus === "ready" ? cosmeticUrl(outfit) : base.url)} />
      {hat && hatStatus === "ready" ? <div style={layer(cosmeticUrl(hat))} /> : null}
    </div>
  )
}
