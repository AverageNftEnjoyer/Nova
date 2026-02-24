"use client"

import { useMemo, useState } from "react"

function seeded(index: number, salt: number, bootSeed = 0): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233 + bootSeed * 0.0001) * 43758.5453
  return value - Math.floor(value)
}

type PlanetSurface = "ocean" | "gas" | "ice" | "volcanic" | "cratered"
type RingType = "none" | "single" | "double"
type FlightPath = {
  startLeft: string
  startTop: string
  deltaX: string
  deltaY: string
  heading: string
  facing: number
}

export function SpaceBackground() {
  const [bootSeed] = useState(() => Math.floor(Math.random() * 1_000_000_000))

  const planetPalettes = useMemo(
    () => [
      { base: "rgba(70, 136, 229, 0.78)", glow: "rgba(98, 166, 255, 0.32)", atmo: "rgba(168, 212, 255, 0.48)" }, // blue hero
      { base: "rgba(210, 126, 92, 0.72)", glow: "rgba(255, 168, 112, 0.28)", atmo: "rgba(255, 214, 176, 0.38)" }, // terracotta
      { base: "rgba(112, 196, 167, 0.7)", glow: "rgba(140, 231, 201, 0.26)", atmo: "rgba(189, 255, 235, 0.32)" }, // mint
      { base: "rgba(145, 112, 210, 0.7)", glow: "rgba(196, 152, 250, 0.26)", atmo: "rgba(230, 201, 255, 0.34)" }, // amethyst
      { base: "rgba(208, 168, 88, 0.7)", glow: "rgba(245, 206, 121, 0.25)", atmo: "rgba(255, 234, 172, 0.32)" }, // amber
      { base: "rgba(96, 168, 220, 0.68)", glow: "rgba(139, 207, 248, 0.25)", atmo: "rgba(196, 238, 255, 0.32)" }, // azure
      { base: "rgba(180, 108, 138, 0.68)", glow: "rgba(232, 145, 182, 0.24)", atmo: "rgba(255, 204, 224, 0.3)" }, // rose
      { base: "rgba(132, 154, 190, 0.66)", glow: "rgba(177, 200, 235, 0.22)", atmo: "rgba(222, 236, 255, 0.28)" }, // steel
    ],
    [],
  )

  const planets = useMemo(
    () => {
      const targetCount = 5 + Math.floor(seeded(1, 40, bootSeed) * 2) // 5..6
      const paletteOrder = [...planetPalettes]
        .map((palette, index) => ({ palette, rank: seeded(index, 41, bootSeed) }))
        .sort((a, b) => a.rank - b.rank)
        .map((row) => row.palette)
      const selectedPalettes = [planetPalettes[0], ...paletteOrder.filter((p) => p !== planetPalettes[0])]
      const placed: Array<{ left: number; top: number; sizePct: number }> = []
      const out: Array<Record<string, unknown>> = []
      const archetypes: Array<{
        leftMin: number
        leftRange: number
        topMin: number
        topRange: number
        minSize: number
        maxSize: number
        surface: PlanetSurface
        ringType: RingType
        forceBands?: boolean
        forceMoon?: boolean
        opacityMin: number
        opacityRange: number
        zIndex: number
        isHero?: boolean
      }> = [
        {
          leftMin: 72,
          leftRange: 18,
          topMin: 5,
          topRange: 14,
          minSize: 176,
          maxSize: 238,
          surface: "ocean",
          ringType: "none",
          forceBands: false,
          forceMoon: true,
          opacityMin: 0.42,
          opacityRange: 0.14,
          zIndex: 3,
          isHero: true,
        },
        {
          leftMin: 4,
          leftRange: 16,
          topMin: 66,
          topRange: 20,
          minSize: 124,
          maxSize: 174,
          surface: "gas",
          ringType: "double",
          forceBands: true,
          forceMoon: false,
          opacityMin: 0.36,
          opacityRange: 0.16,
          zIndex: 2,
        },
        {
          leftMin: 4,
          leftRange: 16,
          topMin: 8,
          topRange: 14,
          minSize: 54,
          maxSize: 92,
          surface: "ice",
          ringType: "single",
          forceBands: false,
          forceMoon: false,
          opacityMin: 0.28,
          opacityRange: 0.2,
          zIndex: 1,
        },
        {
          leftMin: 82,
          leftRange: 14,
          topMin: 74,
          topRange: 16,
          minSize: 74,
          maxSize: 116,
          surface: "volcanic",
          ringType: "none",
          forceBands: false,
          forceMoon: false,
          opacityMin: 0.32,
          opacityRange: 0.18,
          zIndex: 2,
        },
        {
          leftMin: 36,
          leftRange: 22,
          topMin: 14,
          topRange: 20,
          minSize: 90,
          maxSize: 132,
          surface: "cratered",
          ringType: "single",
          forceBands: false,
          forceMoon: true,
          opacityMin: 0.24,
          opacityRange: 0.2,
          zIndex: 1,
        },
        {
          leftMin: 46,
          leftRange: 20,
          topMin: 58,
          topRange: 22,
          minSize: 62,
          maxSize: 98,
          surface: "ice",
          ringType: "none",
          forceBands: false,
          forceMoon: false,
          opacityMin: 0.22,
          opacityRange: 0.2,
          zIndex: 1,
        },
      ]

      for (let i = 0; i < targetCount; i += 1) {
        const archetype = archetypes[i % archetypes.length]
        const baseSize = archetype.minSize + Math.round(seeded(i, 42, bootSeed) * (archetype.maxSize - archetype.minSize))
        let left = archetype.leftMin + Math.round(seeded(i, 44, bootSeed) * archetype.leftRange)
        let top = archetype.topMin + Math.round(seeded(i, 45, bootSeed) * archetype.topRange)
        const sizePct = (baseSize / 1366) * 100
        for (let attempt = 0; attempt < 24; attempt += 1) {
          const overlaps = placed.some((existing) => {
            const dx = left - existing.left
            const dy = top - existing.top
            const dist = Math.sqrt(dx * dx + dy * dy)
            return dist < (sizePct + existing.sizePct) * 0.6
          })
          if (!overlaps) break
          left = archetype.leftMin + Math.round(seeded(i + attempt + 1, 46, bootSeed) * archetype.leftRange)
          top = archetype.topMin + Math.round(seeded(i + attempt + 1, 47, bootSeed) * archetype.topRange)
        }
        placed.push({ left, top, sizePct })
        const ringType = archetype.ringType
        const hasRing = ringType !== "none"
        const hasDoubleRing = ringType === "double"
        const hasBands = archetype.forceBands || seeded(i, 49, bootSeed) > 0.55
        const hasCraters = archetype.surface === "cratered"
        const hasStorm = archetype.surface === "ocean"
        const hasPolarCap = archetype.surface === "ice"
        const hasTectonics = archetype.surface === "volcanic"
        const hasMoon = archetype.forceMoon || seeded(i, 68, bootSeed) > 0.72
        const craterScale = 0.65 + seeded(i, 50, bootSeed) * 0.95
        const bandA = 24 + Math.round(seeded(i, 51, bootSeed) * 20)
        const bandB = 48 + Math.round(seeded(i, 52, bootSeed) * 20)
        const craterALeft = 16 + Math.round(seeded(i, 53, bootSeed) * 24)
        const craterATop = 34 + Math.round(seeded(i, 54, bootSeed) * 22)
        const craterBRight = 12 + Math.round(seeded(i, 55, bootSeed) * 24)
        const craterBTop = 16 + Math.round(seeded(i, 56, bootSeed) * 26)
        const ringWidth = 132 + Math.round(seeded(i, 62, bootSeed) * 26)
        const ringHeight = 16 + Math.round(seeded(i, 63, bootSeed) * 12)
        const moonSize = 8 + Math.round(seeded(i, 64, bootSeed) * 8)
        const moonOffsetX = 74 + Math.round(seeded(i, 65, bootSeed) * 40)
        const moonOffsetY = 10 + Math.round(seeded(i, 66, bootSeed) * 34)
        const moonOpacity = 0.28 + seeded(i, 67, bootSeed) * 0.36

        out.push({
          id: `planet-${i}`,
          size: baseSize,
          left: `${left}%`,
          top: `${top}%`,
          opacity: archetype.opacityMin + seeded(i, 57, bootSeed) * archetype.opacityRange,
          hasRing,
          hasDoubleRing,
          hasBands,
          hasCraters,
          hasStorm,
          hasPolarCap,
          hasTectonics,
          hasMoon,
          surface: archetype.surface,
          isBlueHero: Boolean(archetype.isHero),
          zIndex: archetype.zIndex,
          ringTilt: `${Math.round(-34 + seeded(i, 58, bootSeed) * 68)}deg`,
          ringOpacity: 0.2 + seeded(i, 59, bootSeed) * 0.32,
          ringWidth,
          ringHeight,
          driftDuration: `${(20 + seeded(i, 60, bootSeed) * 28).toFixed(2)}s`,
          driftDelay: `${(seeded(i, 61, bootSeed) * 6).toFixed(2)}s`,
          craterScale,
          bandA,
          bandB,
          craterALeft,
          craterATop,
          craterBRight,
          craterBTop,
          moonSize,
          moonOffsetX,
          moonOffsetY,
          moonOpacity,
          palette: selectedPalettes[i % selectedPalettes.length],
        })
      }
      return out as Array<{
        id: string
        size: number
        left: string
        top: string
        opacity: number
        hasRing: boolean
        hasDoubleRing: boolean
        hasBands: boolean
        hasCraters: boolean
        hasStorm: boolean
        hasPolarCap: boolean
        hasTectonics: boolean
        hasMoon: boolean
        surface: PlanetSurface
        isBlueHero: boolean
        zIndex: number
        ringTilt: string
        ringOpacity: number
        ringWidth: number
        ringHeight: number
        driftDuration: string
        driftDelay: string
        craterScale: number
        bandA: number
        bandB: number
        craterALeft: number
        craterATop: number
        craterBRight: number
        craterBTop: number
        moonSize: number
        moonOffsetX: number
        moonOffsetY: number
        moonOpacity: number
        palette: { base: string; glow: string; atmo: string }
      }>
    },
    [bootSeed, planetPalettes],
  )

  const stars = useMemo(
    () =>
      Array.from({ length: 170 }, (_, index) => {
        const size = 1 + Math.floor(seeded(index, 2, bootSeed) * 3)
        const accent = seeded(index, 9, bootSeed) > 0.58
        return {
          id: `s-${index}`,
          left: `${Math.round(seeded(index, 3, bootSeed) * 10000) / 100}%`,
          top: `${Math.round(seeded(index, 4, bootSeed) * 10000) / 100}%`,
          size,
          opacity: 0.28 + seeded(index, 5, bootSeed) * 0.72,
          duration: 1.3 + seeded(index, 6, bootSeed) * 3.4,
          delay: seeded(index, 7, bootSeed) * 4,
          accent,
        }
      }),
    [bootSeed],
  )

  const pulseStars = useMemo(
    () =>
      Array.from({ length: 28 }, (_, index) => {
        return {
          id: `p-${index}`,
          left: `${Math.round(seeded(index, 17, bootSeed) * 10000) / 100}%`,
          top: `${Math.round(seeded(index, 18, bootSeed) * 10000) / 100}%`,
          delay: `${(seeded(index, 19, bootSeed) * 2.4).toFixed(2)}s`,
          duration: `${(1.8 + seeded(index, 20, bootSeed) * 2.2).toFixed(2)}s`,
        }
      }),
    [bootSeed],
  )

  const shootingStars = useMemo(
    () =>
      Array.from({ length: 5 }, (_, index) => ({
        id: `shoot-${index}`,
        top: `${-14 + Math.round(seeded(index, 13, bootSeed) * 28)}%`,
        left: `${-10 + Math.round(seeded(index, 14, bootSeed) * 88)}%`,
        delay: `${(8 + seeded(index, 15, bootSeed) * 28).toFixed(2)}s`,
        duration: `${(62 + seeded(index, 16, bootSeed) * 38).toFixed(2)}s`,
        scale: (0.78 + seeded(index, 21, bootSeed) * 0.55).toFixed(2),
      })),
    [bootSeed],
  )

  const asteroids = useMemo(
    () =>
      Array.from({ length: 9 }, (_, index) => ({
        id: `ast-${index}`,
        top: `${8 + Math.round(seeded(index, 22, bootSeed) * 78)}%`,
        left: `${-12 + Math.round(seeded(index, 23, bootSeed) * 118)}%`,
        size: `${5 + Math.round(seeded(index, 24, bootSeed) * 10)}px`,
        delay: `${(seeded(index, 25, bootSeed) * 18).toFixed(2)}s`,
        duration: `${(16 + seeded(index, 26, bootSeed) * 24).toFixed(2)}s`,
      })),
    [bootSeed],
  )

  const rockets = useMemo(
    () =>
      Array.from({ length: 2 }, (_, index) => ({
        id: `rocket-${index}`,
        top: `${20 + Math.round(seeded(index, 27, bootSeed) * 44)}%`,
        delay: `${(12 + seeded(index, 28, bootSeed) * 42).toFixed(2)}s`,
        duration: `${(92 + seeded(index, 29, bootSeed) * 20).toFixed(2)}s`,
      })),
    [bootSeed],
  )

  const launchRockets = useMemo(
    () =>
      Array.from({ length: 1 }, (_, index) => ({
        id: `launch-${index}`,
        left: `${12 + Math.round(seeded(index, 69, bootSeed) * 74)}%`,
        delay: `${(36 + seeded(index, 70, bootSeed) * 90).toFixed(2)}s`,
        duration: `${(128 + seeded(index, 71, bootSeed) * 72).toFixed(2)}s`,
        spinDuration: `${(4.8 + seeded(index, 72, bootSeed) * 3.1).toFixed(2)}s`,
      })),
    [bootSeed],
  )

  const meteors = useMemo(
    () =>
      Array.from({ length: 2 }, (_, index) => ({
        id: `meteor-${index}`,
        top: `${-10 + Math.round(seeded(index, 30, bootSeed) * 20)}%`,
        left: `${12 + Math.round(seeded(index, 31, bootSeed) * 70)}%`,
        delay: `${(22 + seeded(index, 32, bootSeed) * 68).toFixed(2)}s`,
        duration: `${(108 + seeded(index, 33, bootSeed) * 26).toFixed(2)}s`,
      })),
    [bootSeed],
  )

  const alienShips = useMemo(
    () => {
      const buildPath = (index: number, salt: number): FlightPath => {
        const route = Math.floor(seeded(index, salt, bootSeed) * 4)
        if (route === 0) {
          return {
            startLeft: "-18%",
            startTop: `${10 + Math.round(seeded(index, salt + 1, bootSeed) * 70)}%`,
            deltaX: "132vw",
            deltaY: "-10px",
            heading: "0deg",
            facing: 1,
          }
        }
        if (route === 1) {
          return {
            startLeft: "112%",
            startTop: `${10 + Math.round(seeded(index, salt + 2, bootSeed) * 70)}%`,
            deltaX: "-132vw",
            deltaY: "10px",
            heading: "180deg",
            facing: -1,
          }
        }
        if (route === 2) {
          return {
            startLeft: `${12 + Math.round(seeded(index, salt + 3, bootSeed) * 74)}%`,
            startTop: "-18%",
            deltaX: "14px",
            deltaY: "132vh",
            heading: "90deg",
            facing: 1,
          }
        }
        return {
          startLeft: `${12 + Math.round(seeded(index, salt + 4, bootSeed) * 74)}%`,
          startTop: "112%",
          deltaX: "-14px",
          deltaY: "-132vh",
          heading: "-90deg",
          facing: 1,
        }
      }
      return Array.from({ length: 2 }, (_, index) => {
        const path = buildPath(index, 73)
        return {
          id: `alien-${index}`,
          delay: `${(28 + seeded(index, 74, bootSeed) * 92).toFixed(2)}s`,
          duration: `${(96 + seeded(index, 75, bootSeed) * 86).toFixed(2)}s`,
          tilt: `${(-4 + seeded(index, 76, bootSeed) * 8).toFixed(2)}deg`,
          ...path,
        }
      })
    },
    [bootSeed],
  )

  const battleStations = useMemo(
    () =>
      Array.from({ length: 1 }, (_, index) => ({
        id: `station-${index}`,
        top: `${6 + Math.round(seeded(index, 77, bootSeed) * 22)}%`,
        left: `${66 + Math.round(seeded(index, 78, bootSeed) * 24)}%`,
        size: `${84 + Math.round(seeded(index, 79, bootSeed) * 42)}px`,
        delay: `${(44 + seeded(index, 80, bootSeed) * 120).toFixed(2)}s`,
        duration: `${(150 + seeded(index, 81, bootSeed) * 120).toFixed(2)}s`,
      })),
    [bootSeed],
  )

  const tieFighters = useMemo(
    () => {
      const buildPath = (index: number, salt: number): FlightPath => {
        const route = Math.floor(seeded(index, salt, bootSeed) * 4)
        if (route === 0) {
          return {
            startLeft: "-18%",
            startTop: `${12 + Math.round(seeded(index, salt + 1, bootSeed) * 68)}%`,
            deltaX: "128vw",
            deltaY: "-20px",
            heading: "0deg",
            facing: 1,
          }
        }
        if (route === 1) {
          return {
            startLeft: "112%",
            startTop: `${12 + Math.round(seeded(index, salt + 2, bootSeed) * 68)}%`,
            deltaX: "-128vw",
            deltaY: "20px",
            heading: "180deg",
            facing: -1,
          }
        }
        if (route === 2) {
          return {
            startLeft: `${10 + Math.round(seeded(index, salt + 3, bootSeed) * 76)}%`,
            startTop: "-20%",
            deltaX: "14px",
            deltaY: "132vh",
            heading: "90deg",
            facing: 1,
          }
        }
        return {
          startLeft: `${10 + Math.round(seeded(index, salt + 4, bootSeed) * 76)}%`,
          startTop: "114%",
          deltaX: "-14px",
          deltaY: "-132vh",
          heading: "-90deg",
          facing: 1,
        }
      }
      return Array.from({ length: 2 }, (_, index) => {
        const path = buildPath(index, 82)
        return {
          id: `tie-${index}`,
          delay: `${(34 + seeded(index, 83, bootSeed) * 126).toFixed(2)}s`,
          duration: `${(118 + seeded(index, 84, bootSeed) * 96).toFixed(2)}s`,
          scale: (0.8 + seeded(index, 85, bootSeed) * 0.5).toFixed(2),
          tilt: `${(-8 + seeded(index, 86, bootSeed) * 16).toFixed(2)}deg`,
          laserDelay: `${(seeded(index, 87, bootSeed) * 0.42).toFixed(2)}s`,
          ...path,
        }
      })
    },
    [bootSeed],
  )

  const backgroundStations = useMemo(
    () =>
      Array.from({ length: 2 }, (_, index) => ({
        id: `bg-station-${index}`,
        top: `${8 + Math.round(seeded(index, 88, bootSeed) * 70)}%`,
        left: `${106 + Math.round(seeded(index, 89, bootSeed) * 12)}%`,
        size: `${52 + Math.round(seeded(index, 90, bootSeed) * 36)}px`,
        delay: `${(seeded(index, 91, bootSeed) * 40).toFixed(2)}s`,
        duration: `${(220 + seeded(index, 92, bootSeed) * 120).toFixed(2)}s`,
        driftY: `${(-20 + Math.round(seeded(index, 93, bootSeed) * 40))}px`,
      })),
    [bootSeed],
  )

  return (
    <div className="space-bg absolute inset-0 overflow-hidden">
      <div className="space-bg__base" />
      <div className="space-bg__nebula space-bg__nebula--left" />
      <div className="space-bg__nebula space-bg__nebula--right" />
      <div className="space-bg__nebula space-bg__nebula--bottom" />
      <div className="space-bg__deep-stations">
        {backgroundStations.map((station) => (
          <span
            key={station.id}
            className="space-bg__deep-station"
            style={{
              top: station.top,
              left: station.left,
              width: station.size,
              height: station.size,
              animationDelay: station.delay,
              animationDuration: station.duration,
              ["--space-deep-station-dy" as string]: station.driftY,
            }}
          >
            <span className="space-bg__deep-station-hull" />
            <span className="space-bg__deep-station-truss" />
            <span className="space-bg__deep-station-panel space-bg__deep-station-panel--left" />
            <span className="space-bg__deep-station-panel space-bg__deep-station-panel--right" />
            <span className="space-bg__deep-station-dish" />
          </span>
        ))}
      </div>

      <div className="space-bg__stars">
        {stars.map((star) => (
          <span
            key={star.id}
            className={`space-bg__star ${star.accent ? "space-bg__star--accent" : ""}`}
            style={{
              left: star.left,
              top: star.top,
              width: `${star.size}px`,
              height: `${star.size}px`,
              opacity: star.opacity,
              animationDelay: `${star.delay}s`,
              animationDuration: `${star.duration}s`,
            }}
          />
        ))}
      </div>

      <div className="space-bg__planet-field">
        {planets.map((planet) => (
          <span
            key={planet.id}
            className={`space-bg__planet-shell ${planet.isBlueHero ? "space-bg__planet-shell--hero" : ""} space-bg__planet-shell--${planet.surface}`}
            style={{
              left: planet.left,
              top: planet.top,
              width: `${planet.size}px`,
              height: `${planet.size}px`,
              opacity: planet.opacity,
              zIndex: planet.zIndex,
              animationDelay: planet.driftDelay,
              animationDuration: planet.driftDuration,
              ["--planet-base" as string]: planet.palette.base,
              ["--planet-glow" as string]: planet.palette.glow,
              ["--planet-atmo" as string]: planet.palette.atmo,
              ["--planet-ring-tilt" as string]: planet.ringTilt,
              ["--planet-ring-opacity" as string]: `${planet.ringOpacity}`,
              ["--planet-ring-width" as string]: `${planet.ringWidth}%`,
              ["--planet-ring-height" as string]: `${planet.ringHeight}%`,
              ["--planet-crater-scale" as string]: `${planet.craterScale}`,
              ["--planet-band-a-top" as string]: `${planet.bandA}%`,
              ["--planet-band-b-top" as string]: `${planet.bandB}%`,
              ["--planet-crater-a-left" as string]: `${planet.craterALeft}%`,
              ["--planet-crater-a-top" as string]: `${planet.craterATop}%`,
              ["--planet-crater-b-right" as string]: `${planet.craterBRight}%`,
              ["--planet-crater-b-top" as string]: `${planet.craterBTop}%`,
              ["--planet-moon-size" as string]: `${planet.moonSize}px`,
              ["--planet-moon-x" as string]: `${planet.moonOffsetX}%`,
              ["--planet-moon-y" as string]: `${planet.moonOffsetY}%`,
              ["--planet-moon-opacity" as string]: `${planet.moonOpacity}`,
            }}
          >
            <span className="space-bg__planet-atmo" />
            {planet.hasBands && (
              <>
                <span className="space-bg__planet-band space-bg__planet-band--a" />
                <span className="space-bg__planet-band space-bg__planet-band--b" />
              </>
            )}
            {planet.hasCraters && (
              <>
                <span className="space-bg__planet-crater space-bg__planet-crater--a" />
                <span className="space-bg__planet-crater space-bg__planet-crater--b" />
              </>
            )}
            {planet.hasStorm && <span className="space-bg__planet-storm" />}
            {planet.hasPolarCap && <span className="space-bg__planet-polar-cap" />}
            {planet.hasTectonics && <span className="space-bg__planet-tectonics" />}
            {planet.hasRing && <span className="space-bg__planet-ring" />}
            {planet.hasDoubleRing && <span className="space-bg__planet-ring space-bg__planet-ring--inner" />}
            {planet.hasMoon && <span className="space-bg__planet-moon" />}
          </span>
        ))}
      </div>

      <div className="space-bg__shooters">
        {shootingStars.map((shooting) => (
          <span
            key={shooting.id}
            className="space-bg__shooting-star"
            style={{
              top: shooting.top,
              left: shooting.left,
              animationDelay: shooting.delay,
              animationDuration: shooting.duration,
              ["--space-shoot-scale" as string]: shooting.scale,
            }}
          />
        ))}
      </div>

      <div className="space-bg__meteors">
        {meteors.map((meteor) => (
          <span
            key={meteor.id}
            className="space-bg__meteor"
            style={{
              top: meteor.top,
              left: meteor.left,
              animationDelay: meteor.delay,
              animationDuration: meteor.duration,
            }}
          />
        ))}
      </div>

      <div className="space-bg__pulse-stars">
        {pulseStars.map((pulseStar) => (
          <span
            key={pulseStar.id}
            className="space-bg__pulse-star"
            style={{
              left: pulseStar.left,
              top: pulseStar.top,
              animationDelay: pulseStar.delay,
              animationDuration: pulseStar.duration,
            }}
          />
        ))}
      </div>

      <div className="space-bg__asteroids">
        {asteroids.map((asteroid) => (
          <span
            key={asteroid.id}
            className="space-bg__asteroid"
            style={{
              top: asteroid.top,
              left: asteroid.left,
              width: asteroid.size,
              height: asteroid.size,
              animationDelay: asteroid.delay,
              animationDuration: asteroid.duration,
            }}
          />
        ))}
      </div>

      <div className="space-bg__rockets">
        {rockets.map((rocket) => (
          <span
            key={rocket.id}
            className="space-bg__rocket"
            style={{
              top: rocket.top,
              animationDelay: rocket.delay,
              animationDuration: rocket.duration,
            }}
          >
            <span className="space-bg__rocket-fin" />
            <span className="space-bg__rocket-window" />
            <span className="space-bg__rocket-flame" />
          </span>
        ))}
      </div>

      <div className="space-bg__launches">
        {launchRockets.map((rocket) => (
          <span
            key={rocket.id}
            className="space-bg__rocket space-bg__rocket--launch"
            style={{
              left: rocket.left,
              animationDelay: rocket.delay,
              animationDuration: rocket.duration,
            }}
          >
            <span className="space-bg__rocket-spin" style={{ animationDuration: rocket.spinDuration }}>
              <span className="space-bg__rocket-fin" />
              <span className="space-bg__rocket-window" />
              <span className="space-bg__rocket-flame" />
            </span>
          </span>
        ))}
      </div>

      <div className="space-bg__battle-stations">
        {battleStations.map((station) => (
          <span
            key={station.id}
            className="space-bg__battle-station"
            style={{
              top: station.top,
              left: station.left,
              width: station.size,
              height: station.size,
              animationDelay: station.delay,
              animationDuration: station.duration,
            }}
          >
            <span className="space-bg__battle-station-trench" />
            <span className="space-bg__battle-station-dish" />
          </span>
        ))}
      </div>

      <div className="space-bg__alien-ships">
        {alienShips.map((ship) => (
          <span
            key={ship.id}
            className="space-bg__alien-ship"
            style={{
              top: ship.startTop,
              left: ship.startLeft,
              animationDelay: ship.delay,
              animationDuration: ship.duration,
              ["--space-alien-tilt" as string]: ship.tilt,
              ["--space-alien-heading" as string]: ship.heading,
              ["--space-alien-dx" as string]: ship.deltaX,
              ["--space-alien-dy" as string]: ship.deltaY,
              ["--space-alien-facing" as string]: `${ship.facing}`,
            }}
          >
            <span className="space-bg__alien-dome" />
            <span className="space-bg__alien-lights" />
          </span>
        ))}
      </div>

      <div className="space-bg__tie-squad">
        {tieFighters.map((fighter) => (
          <span
            key={fighter.id}
            className="space-bg__tie-fighter"
            style={{
              top: fighter.startTop,
              left: fighter.startLeft,
              animationDelay: fighter.delay,
              animationDuration: fighter.duration,
              ["--space-tie-scale" as string]: fighter.scale,
              ["--space-tie-tilt" as string]: fighter.tilt,
              ["--space-tie-heading" as string]: fighter.heading,
              ["--space-tie-dx" as string]: fighter.deltaX,
              ["--space-tie-dy" as string]: fighter.deltaY,
              ["--space-tie-facing" as string]: `${fighter.facing}`,
              ["--space-tie-laser-delay" as string]: fighter.laserDelay,
            }}
          >
            <span className="space-bg__tie-wing space-bg__tie-wing--left" />
            <span className="space-bg__tie-wing-link space-bg__tie-wing-link--left" />
            <span className="space-bg__tie-cockpit" />
            <span className="space-bg__tie-wing-link space-bg__tie-wing-link--right" />
            <span className="space-bg__tie-wing space-bg__tie-wing--right" />
            <span className="space-bg__tie-laser space-bg__tie-laser--a" />
            <span className="space-bg__tie-laser space-bg__tie-laser--b" />
          </span>
        ))}
      </div>

      <div className="space-bg__vignette" />
    </div>
  )
}
