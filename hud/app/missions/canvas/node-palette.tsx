"use client"

import { useState } from "react"
import { Search } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { NODE_CATALOG, PALETTE_CATEGORIES, searchCatalog, type NodeCatalogEntry, type NodePaletteCategory } from "@/lib/missions/catalog"
import type { MissionNodeType } from "@/lib/missions/types"

interface NodePaletteProps {
  onAddNode: (type: MissionNodeType, label: string) => void
  className?: string
}

export function NodePalette({ onAddNode, className }: NodePaletteProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState<NodePaletteCategory | "all">("all")

  const results = searchQuery.trim()
    ? searchCatalog(searchQuery)
    : activeCategory === "all"
      ? NODE_CATALOG
      : NODE_CATALOG.filter((e) => e.category === activeCategory)

  const handleDragStart = (e: React.DragEvent, entry: NodeCatalogEntry) => {
    e.dataTransfer.setData("application/nova-mission-node-type", entry.type)
    e.dataTransfer.setData("application/nova-mission-node-label", entry.label)
    e.dataTransfer.effectAllowed = "copy"
  }

  return (
    <aside
      className={cn(
        "flex h-full w-64 flex-col border-r border-white/10 bg-gradient-to-b from-slate-950/90 via-slate-950/80 to-black/75 backdrop-blur-xl",
        className,
      )}
    >
      <div className="border-b border-white/10 px-3 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">Components</p>
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <Search className="h-3.5 w-3.5 shrink-0 text-white/40" />
          <input
            className="w-full bg-transparent text-xs text-white/85 placeholder:text-white/30 focus:outline-none"
            placeholder="Search components..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {!searchQuery.trim() && (
        <div className="border-b border-white/10 px-3 py-2.5">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveCategory("all")}
              className={cn(
                "rounded-lg border px-2 py-1 text-[10px] font-semibold tracking-wide transition-colors",
                activeCategory === "all"
                  ? "border-cyan-300/30 bg-cyan-500/15 text-cyan-100"
                  : "border-white/10 bg-white/[0.04] text-white/50 hover:text-white/75",
              )}
            >
              All
            </button>
            {PALETTE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  "rounded-lg border px-2 py-1 text-[10px] font-semibold tracking-wide transition-colors",
                  activeCategory === cat.id
                    ? "border-cyan-300/30 bg-cyan-500/15 text-cyan-100"
                    : "border-white/10 bg-white/[0.04] text-white/50 hover:text-white/75",
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2.5 scrollbar-none">
        {results.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-black/20 px-2 py-4 text-center text-xs text-white/35">
            No components found.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {results.map((entry) => (
              <div
                key={entry.type}
                draggable
                onDragStart={(e) => handleDragStart(e, entry)}
                onClick={() => onAddNode(entry.type, entry.label)}
                className={cn(
                  "group cursor-grab rounded-xl border px-2.5 py-2.5 transition-all active:cursor-grabbing",
                  entry.color,
                  entry.borderColor,
                  "bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.07]",
                )}
                title={entry.description}
              >
                <div className="flex items-start gap-2.5">
                  <span className={cn("mt-0.5 h-2 w-2 rounded-full", entry.textColor.replace("text-", "bg-"))} />
                  <div className="min-w-0">
                    <div className={cn("truncate text-xs font-semibold", entry.textColor)}>{entry.label}</div>
                    <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-white/45">{entry.description}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
