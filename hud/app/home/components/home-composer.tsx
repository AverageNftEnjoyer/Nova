"use client"

import { useRef, useState, type KeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import { ArrowUp, Rocket } from "lucide-react"

import { Button, Kbd, Textarea } from "@/components/ui"

interface HomeComposerProps {
  /** The active provider's model ("Claude Sonnet 5"), shown quietly when known. */
  modelLabel: string | null
}

function chatHref(prompt: string): string {
  return `/chat?new=1&prompt=${encodeURIComponent(prompt)}`
}

function deployHref(prompt: string): string {
  return `/deployments/new?tab=describe&prompt=${encodeURIComponent(prompt)}`
}

/**
 * The prompt box at the top of Home. Enter sends to a new chat, Shift+Enter adds a line, Ctrl+Enter opens the
 * deployment flow with the text prefilled (it is not submitted there).
 */
export function HomeComposer({ modelLabel }: HomeComposerProps) {
  const router = useRouter()
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const prompt = text.trim()

  const sendToChat = () => {
    if (prompt) router.push(chatHref(prompt))
  }
  const deploy = () => {
    if (prompt) router.push(deployHref(prompt))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      deploy()
      return
    }
    if (event.shiftKey) return
    event.preventDefault()
    sendToChat()
  }

  return (
    <section
      aria-label="Ask Nova"
      className="rounded-lg border border-border bg-surface transition-colors focus-within:border-accent-border"
      onClick={(event) => {
        if (event.target === event.currentTarget) inputRef.current?.focus()
      }}
    >
      <label htmlFor="home-composer" className="sr-only">
        What should Nova do?
      </label>
      <Textarea
        id="home-composer"
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="What should Nova do?"
        autoGrow
        minRows={3}
        maxRows={12}
        className="border-0 bg-transparent px-4 pt-3.5 pb-1 text-base leading-6 shadow-none placeholder:text-faint focus-visible:ring-0 focus:border-transparent focus:ring-0"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pb-3 pl-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 text-xs text-faint">
          {modelLabel ? <span className="truncate font-mono text-muted">{modelLabel}</span> : null}
          <span className="hidden items-center gap-1 lg:inline-flex">
            <Kbd>Enter</Kbd>
            <span className="mr-2">chat</span>
            <Kbd>Ctrl</Kbd>
            <Kbd>Enter</Kbd>
            <span className="mr-2">deploy</span>
            <Kbd>Shift</Kbd>
            <Kbd>Enter</Kbd>
            <span>new line</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" disabled={!prompt} onClick={deploy} aria-keyshortcuts="Control+Enter">
            <Rocket />
            Deploy as task
          </Button>
          <Button disabled={!prompt} onClick={sendToChat} aria-keyshortcuts="Enter">
            <ArrowUp />
            Send to chat
          </Button>
        </div>
      </div>
    </section>
  )
}
