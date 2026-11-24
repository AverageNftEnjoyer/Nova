export interface NarrativeSection {
  title: string
  paragraphs: string[]
}

/**
 * Splits a Polymarket market description into titled sections (short capitalised lines are headings) and pulls out
 * a "Market Opened: ..." line when present.
 */
export function parseNarrative(raw: string): { sections: NarrativeSection[]; openedAt: string } {
  const text = String(raw || "").replace(/\r/g, "").trim()
  if (!text) return { sections: [], openedAt: "" }
  const sections: NarrativeSection[] = []
  let current: NarrativeSection | null = null
  let openedAt = ""
  const isHeading = (line: string) => {
    const n = line.replace(/:$/, "").trim()
    return n.length > 0 && n.length <= 36 && !/[.!?]$/.test(n) && /^[A-Z][A-Za-z0-9/&' -]+$/.test(n)
  }
  const commit = () => {
    if (current && current.paragraphs.length > 0) sections.push(current)
    current = null
  }
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue
    let i = 0
    const heads: string[] = []
    while (i < lines.length && isHeading(lines[i])) {
      heads.push(lines[i].replace(/:$/, "").trim())
      i += 1
    }
    if (heads.length > 0) {
      commit()
      current = { title: heads.join(", "), paragraphs: [] }
    }
    if (i >= lines.length) continue
    if (!current) current = { title: "Rules", paragraphs: [] }
    const body = lines.slice(i).join(" ")
    const opened = /^Market Opened:\s*(.+)$/i.exec(body)
    if (opened) {
      openedAt = opened[1].trim()
      continue
    }
    ;(current as NarrativeSection).paragraphs.push(body)
  }
  commit()
  return { sections: sections.length > 0 ? sections : [{ title: "Rules", paragraphs: [text] }], openedAt }
}
