"use client"

import { SearchInput, Select, type SelectOption } from "@/components/ui"

interface MarketSearchProps {
  value: string
  onChange: (next: string) => void
  tag: string
  onTagChange: (next: string) => void
  tags: SelectOption[]
  sort: string
  onSortChange: (next: string) => void
  sortOptions: SelectOption[]
}

/** One filter row above the market table: search, tag, sort. Search ignores the tag (the API searches all markets). */
export function MarketSearch({ value, onChange, tag, onTagChange, tags, sort, onSortChange, sortOptions }: MarketSearchProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        value={value}
        onValueChange={onChange}
        placeholder="Search markets"
        size="sm"
        containerClassName="min-w-48 flex-1"
        aria-label="Search markets"
      />
      <Select value={tag} options={tags} onValueChange={onTagChange} size="sm" aria-label="Tag" className="w-36" disabled={value.trim().length > 0} />
      <Select value={sort} options={sortOptions} onValueChange={onSortChange} size="sm" aria-label="Sort by" className="w-36" />
    </div>
  )
}
