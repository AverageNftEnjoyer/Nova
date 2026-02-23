import { useMemo, useState } from "react"
import { arc as d3Arc, pie as d3Pie } from "d3"

import type { UsageSlice } from "../types"

interface UsageDistributionPanelProps {
  slices: UsageSlice[]
  isLight: boolean
}

const lightPalette = ["#4f7cff", "#3b82f6", "#2f9d8f", "#7a8dff", "#5f7db8", "#8f7ad8", "#4da7b8", "#8aa66a"]
const darkPalette = ["#86b0ff", "#67a6ff", "#5acdc1", "#a1adff", "#8eb1e6", "#b7a0f8", "#7dcfe0", "#a6c98a"]

export function UsageDistributionPanel({ slices, isLight }: UsageDistributionPanelProps) {
  const total = useMemo(() => slices.reduce((sum, slice) => sum + slice.value, 0), [slices])
  const palette = isLight ? lightPalette : darkPalette
  const normalized = useMemo(
    () => slices.map((slice, index) => ({ ...slice, color: palette[index % palette.length] })),
    [palette, slices],
  )
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const activeKey = useMemo(() => {
    if (hoveredKey && normalized.some((slice) => slice.key === hoveredKey)) return hoveredKey
    return normalized[0]?.key ?? null
  }, [hoveredKey, normalized])

  const arcs = useMemo(() => {
    const pieGen = d3Pie<(typeof normalized)[number]>().value((slice) => slice.value).sort(null)
    const arcGen = d3Arc<unknown>().innerRadius(54).outerRadius(94)
    const highlightArc = d3Arc<unknown>().innerRadius(52).outerRadius(100)

    return pieGen(normalized).map((item) => {
      const isActive = item.data.key === activeKey
      const share = total > 0 ? (item.data.value / total) * 100 : 0
      return {
        key: item.data.key,
        label: item.data.label,
        value: item.data.value,
        share,
        color: item.data.color,
        active: isActive,
        path: (isActive ? highlightArc(item) : arcGen(item)) ?? "",
      }
    })
  }, [activeKey, normalized, total])

  const activeSlice = arcs.find((arc) => arc.active) ?? arcs[0]
  const compactNum = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [],
  )

  return (
    <section className="h-full p-4 flex flex-col">
      <h3 className={`text-sm uppercase tracking-[0.22em] font-semibold ${isLight ? "text-s-90" : "text-slate-200"}`}>Usage Distribution</h3>
      <p className={`mt-1 text-xs ${isLight ? "text-s-50" : "text-slate-400"}`}>Request share by integration</p>

      <div className={`home-spotlight-card mt-3 min-h-0 flex-1 flex flex-col rounded-xl border p-3 ${isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/25 backdrop-blur-md"}`}>
        <div className="flex items-center justify-center pb-2" onMouseLeave={() => setHoveredKey(null)}>
          <svg viewBox="0 0 220 220" className="h-52 w-full max-w-[260px]">
            <g transform="translate(110,110)">
              {arcs.map((segment) => (
                <path
                  key={segment.key}
                  d={segment.path}
                  fill={segment.color}
                  fillOpacity={segment.active ? 1 : 0.62}
                  stroke={segment.active ? (isLight ? "#1f2937" : "rgba(255,255,255,0.75)") : "transparent"}
                  strokeWidth={segment.active ? 1.2 : 0}
                  onMouseEnter={() => setHoveredKey(segment.key)}
                />
              ))}
              <text x="0" y="-2" textAnchor="middle" className={isLight ? "fill-s-90" : "fill-slate-100"} fontSize="18" fontWeight="700">
                {activeSlice ? `${activeSlice.share.toFixed(1)}%` : "0%"}
              </text>
              <text x="0" y="18" textAnchor="middle" className={isLight ? "fill-s-50" : "fill-slate-400"} fontSize="11">
                {activeSlice?.label || "No Data"}
              </text>
            </g>
          </svg>
        </div>

        <div
          className={`mt-1 grid grid-cols-3 gap-1.5 ${isLight ? "text-s-80" : "text-slate-200"}`}
          onMouseLeave={() => setHoveredKey(null)}
        >
          {arcs.map((slice) => (
            <div
              key={slice.key}
              onMouseEnter={() => setHoveredKey(slice.key)}
              className={`rounded-md border px-2.5 py-2 text-[13px] leading-none transition-colors ${
                slice.active
                  ? isLight
                    ? "border-[#aebbd0] bg-white text-s-90 shadow-[0_0_0_1px_rgba(174,187,208,0.35)]"
                    : "border-white/25 bg-white/[0.08] text-slate-100"
                  : isLight
                    ? "border-[#d5dce8] bg-white/75"
                    : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                  <span className="truncate font-semibold">{slice.label}</span>
                </span>
                <span className={isLight ? "font-mono text-s-60" : "font-mono text-slate-300"}>{compactNum.format(slice.value)}</span>
                <span className={isLight ? "font-mono text-s-50" : "font-mono text-slate-400"}>{slice.share.toFixed(1)}%</span>
              </span>
            </div>
          ))}
        </div>

        <div className={`mt-2 flex items-center justify-between border-t pt-2 text-xs ${isLight ? "border-[#d5dce8] text-s-60" : "border-white/10 text-slate-400"}`}>
          <span className="uppercase tracking-[0.1em]">Total</span>
          <span className="font-mono">{total.toLocaleString()}</span>
        </div>
      </div>
    </section>
  )
}
