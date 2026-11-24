"use client"

import * as React from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { IconButton, Tooltip } from "@/components/ui"

interface MarkdownRendererProps {
  content: string
  className?: string
  /** While streaming, an unterminated ``` fence still renders as a code block. */
  isStreaming?: boolean
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; language: string; code: string }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; header: string[]; align: Array<"left" | "right" | "center">; rows: string[][] }
  | { kind: "rule" }

interface ListItem {
  text: string
  depth: number
}

const FENCE = /^\s*(```|~~~)\s*([\w#+.-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  return trimmed.split("|").map((cell) => cell.trim())
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const blocks: Block[] = []
  let i = 0

  const isBlockStart = (line: string, next: string | undefined) =>
    FENCE.test(line) ||
    HEADING.test(line) ||
    LIST_ITEM.test(line) ||
    RULE.test(line) ||
    /^\s*>/.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_DIVIDER.test(next))

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i += 1
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      const marker = fence[1]
      const language = fence[2] || ""
      const body: string[] = []
      i += 1
      while (i < lines.length && lines[i].trim() !== marker) {
        body.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push({ kind: "code", language, code: body.join("\n") })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] })
      i += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" })
      i += 1
      continue
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const header = splitTableRow(line)
      const align = splitTableRow(lines[i + 1]).map((cell) =>
        cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left",
      ) as Array<"left" | "right" | "center">
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]))
        i += 1
      }
      blocks.push({ kind: "table", header, align, rows })
      continue
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""))
        i += 1
      }
      blocks.push({ kind: "quote", text: body.join("\n") })
      continue
    }

    const listMatch = line.match(LIST_ITEM)
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2])
      const start = ordered ? Number.parseInt(listMatch[2], 10) || 1 : 1
      const baseIndent = listMatch[1].length
      const items: ListItem[] = []
      while (i < lines.length) {
        const current = lines[i]
        const match = current.match(LIST_ITEM)
        if (match) {
          const indent = match[1].length
          items.push({ text: match[3], depth: Math.max(0, Math.min(3, Math.floor((indent - baseIndent) / 2))) })
          i += 1
          continue
        }
        // Continuation line of the previous item (indented, not blank).
        if (current.trim() && /^\s{2,}/.test(current) && items.length > 0) {
          items[items.length - 1].text += `\n${current.trim()}`
          i += 1
          continue
        }
        break
      }
      blocks.push({ kind: "list", ordered, start, items })
      continue
    }

    const body: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1])) {
      body.push(lines[i])
      i += 1
    }
    blocks.push({ kind: "paragraph", text: body.join("\n") })
  }

  return blocks
}

const SAFE_HREF = /^(https?:\/\/|mailto:)/i
const INLINE_TOKEN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(~~[^~\n]+~~)|(\*[^*\n]+\*|(?<![\w])_[^_\n]+_(?![\w]))|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g

function renderLink(key: string, label: React.ReactNode, href: string, rawLabel: string) {
  if (!SAFE_HREF.test(href)) return <React.Fragment key={key}>{rawLabel}</React.Fragment>
  if (/^source\s+\d+$/i.test(rawLabel.trim())) {
    return (
      <a
        key={key}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={href}
        className="mx-0.5 inline-flex items-center rounded-sm border border-border bg-surface-3 px-1.5 align-baseline font-mono text-2xs text-muted no-underline transition-colors hover:border-border-strong hover:text-fg"
      >
        {label}
      </a>
    )
  }
  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      className="text-accent-text underline decoration-accent-border underline-offset-2 transition-colors hover:decoration-current"
    >
      {label}
    </a>
  )
}

function renderInline(text: string, keyPrefix = "i"): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let last = 0
  let index = 0
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const start = match.index ?? 0
    if (start > last) nodes.push(text.slice(last, start))
    const token = match[0]
    const key = `${keyPrefix}-${index++}`
    if (match[1]) {
      nodes.push(
        <code key={key} className="rounded-sm border border-subtle bg-surface-3 px-1 py-px font-mono text-xs text-fg wrap-anywhere">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (match[2]) {
      nodes.push(<strong key={key} className="font-semibold text-fg">{renderInline(token.slice(2, -2), key)}</strong>)
    } else if (match[3]) {
      nodes.push(<del key={key} className="text-muted">{renderInline(token.slice(2, -2), key)}</del>)
    } else if (match[4]) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>)
    } else if (match[5]) {
      const linkParts = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
      if (linkParts) nodes.push(renderLink(key, renderInline(linkParts[1], key), linkParts[2], linkParts[1]))
      else nodes.push(token)
    } else if (match[6]) {
      nodes.push(renderLink(key, token, token, token))
    }
    last = start + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** Inline content where single newlines stay line breaks (chat replies rely on them). */
function renderLines(text: string, keyPrefix: string): React.ReactNode[] {
  const lines = text.split("\n")
  return lines.flatMap((line, lineIndex) => {
    const parts = renderInline(line, `${keyPrefix}-${lineIndex}`)
    return lineIndex < lines.length - 1 ? [...parts, <br key={`${keyPrefix}-br-${lineIndex}`} />] : parts
  })
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<number | null>(null)
  React.useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-surface-2">
      <div className="flex h-8 items-center justify-between border-b border-subtle pl-3 pr-1">
        <span className="font-mono text-2xs text-muted">{language || "text"}</span>
        <Tooltip content={copied ? "Copied" : "Copy code"}>
          <IconButton size="sm" aria-label={copied ? "Copied" : "Copy code"} onClick={() => void copy()}>
            {copied ? <Check className="text-success" /> : <Copy />}
          </IconButton>
        </Tooltip>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-xs leading-5 text-fg">
        <code>{code}</code>
      </pre>
    </div>
  )
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-5 mb-2 text-base font-semibold tracking-[-0.01em] text-fg",
  2: "mt-5 mb-2 text-md font-semibold text-fg",
  3: "mt-4 mb-1.5 text-sm font-semibold text-fg",
}

function renderBlock(block: Block, index: number): React.ReactNode {
  const key = `b-${index}`
  switch (block.kind) {
    case "heading": {
      const Tag = (`h${Math.min(6, block.level + 2)}` as "h3" | "h4" | "h5" | "h6")
      return (
        <Tag key={key} className={cn(HEADING_CLASS[Math.min(3, block.level)], "first:mt-0")}>
          {renderInline(block.text, key)}
        </Tag>
      )
    }
    case "paragraph":
      return (
        <p key={key} className="my-2 first:mt-0 last:mb-0">
          {renderLines(block.text, key)}
        </p>
      )
    case "code":
      return <CodeBlock key={key} language={block.language} code={block.code} />
    case "quote":
      return (
        <blockquote key={key} className="my-3 border-l-2 border-border-strong pl-3 text-muted">
          {renderLines(block.text, key)}
        </blockquote>
      )
    case "rule":
      return <hr key={key} className="my-4 border-0 border-t border-border" />
    case "table":
      return (
        <div key={key} className="my-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-surface-2">
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th
                    key={cellIndex}
                    className="border-b border-border px-3 py-1.5 text-xs font-medium text-muted"
                    style={{ textAlign: block.align[cellIndex] ?? "left" }}
                  >
                    {renderInline(cell, `${key}-h${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-subtle last:border-b-0">
                  {block.header.map((_, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="px-3 py-1.5 align-top tabular-nums"
                      style={{ textAlign: block.align[cellIndex] ?? "left" }}
                    >
                      {renderInline(row[cellIndex] ?? "", `${key}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul"
      return (
        <ListTag
          key={key}
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={cn("my-2 space-y-1 pl-5", block.ordered ? "list-decimal marker:text-muted" : "list-disc marker:text-faint")}
        >
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex} className="pl-1" style={item.depth > 0 ? { marginLeft: `${item.depth * 1.25}rem` } : undefined}>
              {renderLines(item.text, `${key}-${itemIndex}`)}
            </li>
          ))}
        </ListTag>
      )
    }
  }
}

/** Renders assistant markdown (headings, lists, tables, quotes, code, inline marks) with design tokens. */
export function MarkdownRenderer({ content, className, isStreaming = false }: MarkdownRendererProps) {
  const blocks = React.useMemo(() => {
    const text = String(content || "")
    // An open fence mid-stream parses as a code block that runs to the end, which is what it will become.
    return parseBlocks(isStreaming ? text : text.trimEnd())
  }, [content, isStreaming])

  return (
    <div className={cn("min-w-0 max-w-full text-sm leading-6 text-fg wrap-break-word", className)}>
      {blocks.map(renderBlock)}
    </div>
  )
}
