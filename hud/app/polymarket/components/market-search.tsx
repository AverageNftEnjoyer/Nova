import { ListFilter, Search } from "lucide-react"

import { cn } from "@/lib/shared/utils"

export interface MarketSearchTagOption {
  value: string
  label: string
}

export interface MarketSearchSortOption {
  value: string
  label: string
}

interface MarketSearchProps {
  value: string
  onChange: (next: string) => void
  tag: string
  onTagChange: (next: string) => void
  tags: MarketSearchTagOption[]
  sort: string
  onSortChange: (next: string) => void
  sortOptions: MarketSearchSortOption[]
  isLight: boolean
}

export function MarketSearch({
  value,
  onChange,
  tag,
  onTagChange,
  tags,
  sort,
  onSortChange,
  sortOptions,
  isLight,
}: MarketSearchProps) {
  return (
    <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_11rem_12rem] xl:items-end">
      <div>
        <p className={cn("text-sm font-medium", isLight ? "text-s-90" : "text-slate-100")}>Active market flow</p>
        <p className={cn("mt-0.5 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
          Search markets or keep the crypto-heavy feed pinned on the left.
        </p>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Search live markets"
            className={cn(
              "h-10 w-full rounded-lg border pl-10 pr-3 text-sm outline-none transition-colors",
              isLight
                ? "border-[#d5dce8] bg-[#f4f7fd] text-s-90 placeholder:text-s-40 focus:bg-white"
                : "home-subpanel-surface text-slate-100 placeholder:text-slate-500 focus:border-white/20",
            )}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <label className="flex flex-col gap-1">
          <span className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Tag</span>
          <select
            value={tag}
            onChange={(event) => onTagChange(event.target.value)}
            className={cn(
              "h-10 rounded-lg border px-3 text-sm outline-none transition-colors",
              isLight
                ? "border-[#d5dce8] bg-[#f4f7fd] text-s-80 focus:bg-white"
                : "home-subpanel-surface text-slate-200 focus:border-white/20",
            )}
          >
            {tags.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={cn("inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>
            <ListFilter className="h-3 w-3" /> Sort
          </span>
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value)}
            className={cn(
              "h-10 rounded-lg border px-3 text-sm outline-none transition-colors",
              isLight
                ? "border-[#d5dce8] bg-[#f4f7fd] text-s-80 focus:bg-white"
                : "home-subpanel-surface text-slate-200 focus:border-white/20",
            )}
          >
            {sortOptions.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
