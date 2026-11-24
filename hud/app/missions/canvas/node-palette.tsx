"use client"

import { useMemo, useState, type DragEvent } from "react"

import { SearchInput } from "@/components/ui"
import { getPaletteCatalog, PALETTE_CATEGORIES, searchCatalog, type NodeCatalogEntry } from "@/lib/missions/catalog"
import { CATEGORY_ICON, CATEGORY_TONE } from "./category-tone"

interface NodePaletteProps {
  onAddNode: (entry: NodeCatalogEntry) => void
}

/** Left panel of the canvas: searchable node list grouped by category. Click to add, or drag onto the canvas. */
export function NodePalette({ onAddNode }: NodePaletteProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const catalog = useMemo(() => getPaletteCatalog(), [])
  const results = searchQuery.trim() ? searchCatalog(searchQuery) : catalog
  const groups = PALETTE_CATEGORIES
    .map((category) => ({ category, entries: results.filter((entry) => entry.category === category.id) }))
    .filter((group) => group.entries.length > 0)

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, entry: NodeCatalogEntry) => {
    event.dataTransfer.setData("application/nova-mission-node-type", entry.type)
    event.dataTransfer.setData("application/nova-mission-node-label", entry.label)
    event.dataTransfer.effectAllowed = "copy"
  }

  return (
    <aside aria-label="Nodes" className="flex w-52 shrink-0 xl:w-60 flex-col border-r border-border bg-surface">
      <div className="border-b border-border p-3">
        <SearchInput value={searchQuery} onValueChange={setSearchQuery} placeholder="Search nodes" size="sm" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {groups.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted">No nodes match “{searchQuery.trim()}”.</p>
        ) : (
          groups.map(({ category, entries }) => {
            const Icon = CATEGORY_ICON[category.id]
            return (
              <section key={category.id} className="pb-2">
                <h3 className="px-4 pt-2 pb-1 text-xs font-medium text-muted">{category.label}</h3>
                <ul>
                  {entries.map((entry) => (
                    <li key={entry.type}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => handleDragStart(event, entry)}
                        onClick={() => onAddNode(entry)}
                        title={entry.description}
                        className="group flex w-full cursor-grab items-center gap-2.5 px-4 py-1.5 text-left hover:bg-hover active:cursor-grabbing"
                      >
                        <Icon aria-hidden className="size-3.5 shrink-0" style={{ color: CATEGORY_TONE[category.id] }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-fg">{entry.label}</span>
                          <span className="block truncate text-2xs text-faint">{entry.description}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })
        )}
      </div>
      <p className="border-t border-border px-4 py-2 text-2xs text-faint">Click a node to add it, or drag it onto the canvas.</p>
    </aside>
  )
}
