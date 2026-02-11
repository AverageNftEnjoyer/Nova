"use client"

import { useEffect, useRef, useState } from "react"
import * as d3 from "d3"
import { feature } from "topojson-client"

type BootRotatingGlobeProps = {
  accentPrimary: string
  accentSecondary: string
  className?: string
}

type GeoFeature = {
  type: string
  geometry: unknown
  properties: Record<string, unknown>
}

export function BootRotatingGlobe({ accentPrimary, accentSecondary, className = "" }: BootRotatingGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [worldData, setWorldData] = useState<GeoFeature[]>([])
  const [dims, setDims] = useState({ width: 600, height: 600 })

  useEffect(() => {
    if (!containerRef.current) return

    const updateSize = () => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      setDims({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let active = true
    const loadWorldData = async () => {
      try {
        const response = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
        if (!response.ok) return
        const world = await response.json()
        const countries = (feature(world, world.objects.countries) as unknown as { features: GeoFeature[] }).features
        if (active) setWorldData(countries)
      } catch {
        // Keep the widget silent if data cannot load.
      }
    }
    loadWorldData()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!svgRef.current || worldData.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll("*").remove()

    // Keep globe responsive to container while anchoring visual mass toward bottom-left.
    const centerXRatio = 0.32
    const centerYRatio = 0.7
    const width = dims.width
    const height = dims.height

    const projection = d3
      .geoOrthographic()
      .scale(Math.min(width, height) * (175 / 600))
      .translate([width * centerXRatio, height * centerYRatio])
      .clipAngle(90)
      .precision(0.3)

    const path = d3.geoPath(projection)
    const graticule = d3.geoGraticule10()

    const sphere = svg
      .append("path")
      .datum({ type: "Sphere" })
      .attr("fill", "none")
      .attr("stroke", accentPrimary)
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.9)

    const grid = svg
      .append("path")
      .datum(graticule)
      .attr("fill", "none")
      .attr("stroke", accentSecondary)
      .attr("stroke-width", 0.85)
      .attr("opacity", 0.28)

    const countries = svg
      .append("g")
      .selectAll("path")
      .data(worldData)
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", accentPrimary)
      .attr("stroke-width", 1.05)
      .attr("opacity", 0.62)

    let raf = 0
    let lon = -15
    const lat = -12
    const degreesPerSecond = 43.2
    let lastTs = 0

    const draw = (ts: number) => {
      if (lastTs === 0) lastTs = ts
      const deltaMs = Math.min(50, Math.max(0, ts - lastTs))
      lastTs = ts
      lon += (degreesPerSecond * deltaMs) / 1000
      projection.rotate([lon, lat, 0])
      sphere.attr("d", path as unknown as string)
      grid.attr("d", path as unknown as string)
      countries.attr("d", (d: GeoFeature) => path(d as d3.GeoPermissibleObjects) || "")
      raf = window.requestAnimationFrame(draw)
    }

    raf = window.requestAnimationFrame(draw)
    return () => window.cancelAnimationFrame(raf)
  }, [worldData, accentPrimary, accentSecondary, dims])

  return (
    <div ref={containerRef} className={`relative h-full w-full ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${dims.width} ${dims.height}`}
        className="h-full w-full"
        preserveAspectRatio="none"
      />
    </div>
  )
}
