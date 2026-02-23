import { useEffect, useMemo, useRef, useState } from "react"
import { area as d3Area, curveMonotoneX, max as d3Max, scaleLinear } from "d3"

import type { AnalyticsCategory, RequestTimeseriesPoint } from "../types"

interface RequestVolumePanelProps {
  points: RequestTimeseriesPoint[]
  category: AnalyticsCategory
  isLight: boolean
}

interface SeriesDef {
  key: keyof Pick<RequestTimeseriesPoint, "llm" | "scraper" | "messaging" | "unclassified">
  label: string
  color: string
}

const seriesDefs: SeriesDef[] = [
  { key: "llm", label: "LLMs", color: "#8b5cf6" },
  { key: "scraper", label: "Scrapers", color: "#22c55e" },
  { key: "messaging", label: "Messaging", color: "#3b82f6" },
  { key: "unclassified", label: "Unclassified", color: "#f59e0b" },
]

export function RequestVolumePanel({ points, category, isLight }: RequestVolumePanelProps) {
  const plotHostRef = useRef<HTMLDivElement | null>(null)
  const [plotSize, setPlotSize] = useState({ width: 1200, height: 420 })
  const width = plotSize.width
  const height = plotSize.height
  const margin = { top: 16, right: 20, bottom: 34, left: 42 }
  const innerWidth = Math.max(1, width - margin.left - margin.right)
  const innerHeight = Math.max(1, height - margin.top - margin.bottom)
  const xDomainMax = Math.max(points.length - 1, 1)

  useEffect(() => {
    const host = plotHostRef.current
    if (!host) return

    let rafId = 0
    const measure = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const next = {
          width: Math.max(560, Math.floor(host.clientWidth) - 8),
          height: Math.max(280, Math.floor(host.clientHeight) - 8),
        }
        setPlotSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next))
      })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [])

  const visibleSeries = useMemo(() => {
    if (category === "all") return seriesDefs
    return seriesDefs.filter((series) => series.key === category)
  }, [category])

  const xScale = useMemo(() => scaleLinear().domain([0, xDomainMax]).range([0, innerWidth]), [innerWidth, xDomainMax])

  const yMax = useMemo(() => {
    const maxValue = d3Max(points, (point) => d3Max(visibleSeries, (series) => Number(point[series.key])) ?? 0)
    return Math.max(10, maxValue ?? 10)
  }, [points, visibleSeries])

  const yScale = useMemo(() => scaleLinear().domain([0, yMax * 1.06]).range([innerHeight, 0]).nice(5), [innerHeight, yMax])

  const paths = useMemo(() => {
    return visibleSeries.map((series) => {
      const perSeriesArea = d3Area<RequestTimeseriesPoint>()
        .x((_, index) => xScale(index))
        .y0(yScale(0))
        .y1((point) => yScale(Number(point[series.key])))
        .curve(curveMonotoneX)
      const areaPath = perSeriesArea(points) ?? ""

      return {
        key: series.key,
        label: series.label,
        color: series.color,
        areaPath,
      }
    })
  }, [points, visibleSeries, xScale, yScale])

  const yTicks = yScale.ticks(5)

  return (
    <section className="h-full p-4 flex flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className={`text-sm uppercase tracking-[0.22em] font-semibold ${isLight ? "text-s-90" : "text-slate-200"}`}>Request Volume</h3>
          <p className={`mt-1 text-xs ${isLight ? "text-s-50" : "text-slate-400"}`}>Traffic by service category</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {visibleSeries.map((series) => (
            <span key={series.key} className="inline-flex items-center gap-1.5 font-mono text-s-50">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: series.color }} />
              {series.label}
            </span>
          ))}
        </div>
      </div>

      <div className={`home-spotlight-card min-h-0 flex-1 flex flex-col rounded-xl border p-2.5 ${isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/25 backdrop-blur-md"}`}>
        <div ref={plotHostRef} className="min-h-0 flex-1">
          <svg viewBox={`0 0 ${width} ${height}`} className="pointer-events-none h-full w-full select-none">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {yTicks.map((tick) => (
              <g key={tick}>
                <line x1={0} x2={innerWidth} y1={yScale(tick)} y2={yScale(tick)} stroke={isLight ? "#dde4ef" : "rgba(255,255,255,0.08)"} strokeDasharray="4 4" />
                <text x={-8} y={yScale(tick)} dy="0.32em" textAnchor="end" className={isLight ? "fill-s-40" : "fill-slate-500"} fontSize="11">{tick.toFixed(0)}</text>
              </g>
            ))}

            {paths.map((series) => (
              <g key={series.key}>
                <path d={series.areaPath} fill={series.color} fillOpacity={0.18} />
                <path d={series.areaPath} fill="none" stroke={series.color} strokeWidth="2" />
              </g>
            ))}

            {points.map((point, index) => (
              <text key={point.time} x={xScale(index)} y={innerHeight + 20} textAnchor="middle" className={isLight ? "fill-s-40" : "fill-slate-500"} fontSize="11">
                {point.time}
              </text>
            ))}
          </g>
          </svg>
        </div>
      </div>
    </section>
  )
}
