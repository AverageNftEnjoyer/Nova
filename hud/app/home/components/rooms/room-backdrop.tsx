"use client"

import { useState } from "react"

/** Pictures already found missing this session: reopening a room does not request them again. */
const missing = new Set<string>()

interface RoomBackdropProps {
  /** Picture candidates, tried in order (room-registry.ts `backgrounds`). */
  sources: readonly string[]
  /** The building's name, for the picture's alt text. */
  building: string
}

/**
 * A room's background: a themed pixel backdrop (CSS, always drawn) with the room's uploaded picture over it once one
 * loads. A missing picture moves on to the next candidate and finally leaves just the backdrop: no broken-image icon,
 * and since the layer is absolutely positioned behind the content there is no layout shift either way.
 */
export function RoomBackdrop({ sources, building }: RoomBackdropProps) {
  const [failed, setFailed] = useState<readonly string[]>([])
  const [loaded, setLoaded] = useState<string | null>(null)
  const src = sources.find((candidate) => !missing.has(candidate) && !failed.includes(candidate)) ?? null

  return (
    <div className="room-backdrop" aria-hidden="true">
      {src ? (
        // A plain img: the picture is optional and user-supplied, and must fail quietly (next/image would warn).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={`${building} interior`}
          className="room-backdrop-picture"
          data-loaded={loaded === src ? "true" : undefined}
          onLoad={() => setLoaded(src)}
          onError={() => {
            missing.add(src)
            setFailed((previous) => [...previous, src])
          }}
        />
      ) : null}
    </div>
  )
}
