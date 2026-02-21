"use client"

import { cn } from "@/lib/shared/utils"
import type React from "react"
import { useState, useEffect, useMemo, useRef } from "react"

interface MarkdownRendererProps {
  content: string
  className?: string
  isStreaming?: boolean
}

interface AnalysisWordSpanProps {
  word: string
}

function AnalysisWordSpan({ word }: AnalysisWordSpanProps) {
  const [opacity, setOpacity] = useState(0)
  const [animationComplete, setAnimationComplete] = useState(false)
  const animationRef = useRef<number | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true

    const startTime = performance.now()
    const duration = 130

    const animateReveal = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easeOut = 1 - Math.pow(1 - progress, 3)

      setOpacity(easeOut)

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animateReveal)
      } else {
        setAnimationComplete(true)
      }
    }

    animationRef.current = requestAnimationFrame(animateReveal)
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [])

  return (
    <span
      className="inline text-current"
      style={{
        opacity: animationComplete ? 1 : opacity,
      }}
    >
      {word}
    </span>
  )
}

export function MarkdownRenderer({ content, className, isStreaming = false }: MarkdownRendererProps) {
  const normalizedContent = useMemo(
    () => String(content || "").replace(/^#{1,6}\s+(.+)$/gm, "**$1**"),
    [content],
  )
  const [staticContent, setStaticContent] = useState("")
  const [animatingContent, setAnimatingContent] = useState("")

  useEffect(() => {
    if (isStreaming) {
      // New content is everything after what we've already rendered as static
      const newContent = normalizedContent.slice(staticContent.length)
      setAnimatingContent(newContent)
    } else {
      // Streaming ended - move all content to static
      setStaticContent(normalizedContent)
      setAnimatingContent("")
    }
  }, [normalizedContent, isStreaming, staticContent.length])

  // When animating content gets long enough, move older parts to static
  useEffect(() => {
    if (animatingContent.length > 200) {
      // Move first 150 chars to static (finding a word boundary)
      const cutPoint = animatingContent.lastIndexOf(" ", 150)
      if (cutPoint > 50) {
        setStaticContent((prev) => prev + animatingContent.slice(0, cutPoint + 1))
        setAnimatingContent(animatingContent.slice(cutPoint + 1))
      }
    }
  }, [animatingContent])

  const isSourceLinkLabel = (label: string) => /^source\s+\d+$/i.test(String(label || "").trim())

  const getLinkClassName = (label: string) => {
    const isSourceLink = /^source\s+\d+$/i.test(String(label || "").trim())
    if (isSourceLink) {
      return "group relative inline-flex items-center rounded-full border border-accent-30 bg-accent-10 px-2.5 py-0.5 text-xs font-medium text-accent hover:bg-accent-15 transition-colors"
    }
    return "text-accent hover:text-accent-secondary underline underline-offset-2 transition-colors"
  }

  const renderLinkNode = (key: number, label: string, href: string) => {
    const isSourceLink = isSourceLinkLabel(label)
    return (
      <a
        key={key}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={href}
        className={getLinkClassName(label)}
      >
        {label}
        {isSourceLink && (
          <span
            className="pointer-events-none absolute -top-8 left-1/2 z-20 hidden max-w-65 -translate-x-1/2 truncate rounded-md border border-accent-30 bg-black/80 px-2 py-1 text-[10px] text-slate-100 shadow-lg backdrop-blur group-hover:block"
          >
            {href}
          </span>
        )}
      </a>
    )
  }

  const renderPlainInlineMarkdown = (text: string) => {
    const elements: (string | React.ReactNode)[] = []
    let remaining = text
    let keyIndex = 0

    while (remaining.length > 0) {
      // Check for inline code
      const codeMatch = remaining.match(/^`([^`]+)`/)
      if (codeMatch) {
        elements.push(
          <code key={keyIndex++} className="px-1.5 py-0.5 rounded text-sm font-mono text-violet-300 wrap-anywhere" style={{ backgroundColor: "var(--code-bg)" }}>
            {codeMatch[1]}
          </code>,
        )
        remaining = remaining.slice(codeMatch[0].length)
        continue
      }

      // Check for bold
      const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/)
      if (boldMatch) {
        elements.push(<strong key={keyIndex++}>{boldMatch[1]}</strong>)
        remaining = remaining.slice(boldMatch[0].length)
        continue
      }

      // Check for italic
      const italicMatch = remaining.match(/^\*([^*]+)\*/)
      if (italicMatch) {
        elements.push(<em key={keyIndex++}>{italicMatch[1]}</em>)
        remaining = remaining.slice(italicMatch[0].length)
        continue
      }

      // Check for links
      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
      if (linkMatch) {
        elements.push(renderLinkNode(keyIndex++, linkMatch[1], linkMatch[2]))
        remaining = remaining.slice(linkMatch[0].length)
        continue
      }

      // Find next special character or add remaining text
      const nextSpecial = remaining.search(/[`*[\]()]/)
      if (nextSpecial === -1) {
        elements.push(remaining)
        break
      } else if (nextSpecial === 0) {
        elements.push(remaining[0])
        remaining = remaining.slice(1)
      } else {
        elements.push(remaining.slice(0, nextSpecial))
        remaining = remaining.slice(nextSpecial)
      }
    }

    return elements
  }

  const renderAnimatedInlineMarkdown = (text: string) => {
    const elements: (string | React.ReactNode)[] = []
    let remaining = text
    let keyIndex = 0

    while (remaining.length > 0) {
      // Check for inline code
      const codeMatch = remaining.match(/^`([^`]+)`/)
      if (codeMatch) {
        elements.push(
          <code key={keyIndex++} className="px-1.5 py-0.5 rounded text-sm font-mono text-violet-300 wrap-anywhere" style={{ backgroundColor: "var(--code-bg)" }}>
            {codeMatch[1]}
          </code>,
        )
        remaining = remaining.slice(codeMatch[0].length)
        continue
      }

      // Check for bold
      const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/)
      if (boldMatch) {
        const words = boldMatch[1].split(/(\s+)/)
        elements.push(
          <strong key={keyIndex++}>
            {words.map((word, i) => {
              if (word.match(/\s+/)) return word
              if (!word) return null
              return <AnalysisWordSpan key={`b-${keyIndex}-${i}`} word={word} />
            })}
          </strong>,
        )
        remaining = remaining.slice(boldMatch[0].length)
        continue
      }

      // Check for italic
      const italicMatch = remaining.match(/^\*([^*]+)\*/)
      if (italicMatch) {
        const words = italicMatch[1].split(/(\s+)/)
        elements.push(
          <em key={keyIndex++}>
            {words.map((word, i) => {
              if (word.match(/\s+/)) return word
              if (!word) return null
              return <AnalysisWordSpan key={`i-${keyIndex}-${i}`} word={word} />
            })}
          </em>,
        )
        remaining = remaining.slice(italicMatch[0].length)
        continue
      }

      // Check for links
      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
      if (linkMatch) {
        elements.push(renderLinkNode(keyIndex++, linkMatch[1], linkMatch[2]))
        remaining = remaining.slice(linkMatch[0].length)
        continue
      }

      // Find next special character or add remaining text
      const nextSpecial = remaining.search(/[`*[\]()]/)
      if (nextSpecial === -1) {
        const words = remaining.split(/(\s+)/)
        elements.push(
          ...words.map((word, i) => {
            if (word.match(/\s+/)) return word
            if (!word) return null
            return <AnalysisWordSpan key={`w-${keyIndex++}-${i}`} word={word} />
          }),
        )
        break
      } else if (nextSpecial === 0) {
        elements.push(remaining[0])
        remaining = remaining.slice(1)
      } else {
        const textPart = remaining.slice(0, nextSpecial)
        const words = textPart.split(/(\s+)/)
        elements.push(
          ...words.map((word, i) => {
            if (word.match(/\s+/)) return word
            if (!word) return null
            return <AnalysisWordSpan key={`t-${keyIndex++}-${i}`} word={word} />
          }),
        )
        remaining = remaining.slice(nextSpecial)
      }
    }

    return elements
  }

  const renderCodeBlock = (part: string, partIndex: number) => {
    const codeContent = part.slice(3, -3)
    const firstNewline = codeContent.indexOf("\n")
    const language = firstNewline > 0 ? codeContent.slice(0, firstNewline).trim() : ""
    const code = firstNewline > 0 ? codeContent.slice(firstNewline + 1) : codeContent

    return (
      <pre
        key={partIndex}
        className="my-2 max-w-full p-3 text-s-80 rounded-lg overflow-x-auto text-sm font-mono"
        style={{
          backgroundColor: "var(--code-block-bg)",
          border: "1px solid var(--code-block-border)",
          boxShadow: "var(--code-block-shadow)",
        }}
      >
        {language && <span className="text-xs text-s-30 block mb-2">{language}</span>}
        <code>{code}</code>
      </pre>
    )
  }

  const renderContent = (text: string, animated: boolean) => {
    if (!text) return null

    // Split by code blocks first
    const parts = text.split(/(```[\s\S]*?```)/g)

    return parts.map((part, partIndex) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        return renderCodeBlock(part, partIndex)
      }

      if (animated) {
        return <span key={partIndex}>{renderAnimatedInlineMarkdown(part)}</span>
      }

      return <span key={partIndex}>{renderPlainInlineMarkdown(part)}</span>
    })
  }

  return (
    <div className={cn("min-w-0 max-w-full text-sm whitespace-pre-wrap wrap-break-word wrap-anywhere", className)}>
      {renderContent(staticContent, false)}
      {renderContent(animatingContent, true)}
    </div>
  )
}
