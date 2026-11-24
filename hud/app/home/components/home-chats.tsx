"use client"

import Link from "next/link"
import { MessageSquare, Plus } from "lucide-react"

import { Button, EmptyState, Panel } from "@/components/ui"
import { NEW_CHAT_HREF } from "@/components/shell"
import { setActiveId, type Conversation } from "@/lib/chat/conversations"
import { formatRelative } from "../format"

interface HomeChatsProps {
  conversations: Conversation[]
  now: number
}

const LIMIT = 6

/** The most recently updated chats (archived ones left out). */
export function HomeChats({ conversations, now }: HomeChatsProps) {
  const recent = conversations
    .filter((conversation) => !conversation.archived)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, LIMIT)

  return (
    <Panel
      title="Recent chats"
      icon={<MessageSquare />}
      flush
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link href={NEW_CHAT_HREF}>
            <Plus />
            New chat
          </Link>
        </Button>
      }
    >
      {recent.length === 0 ? (
        <EmptyState size="compact" title="No chats yet" description="Ask Nova something above and the conversation is kept here." />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {recent.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/chat?thread=${encodeURIComponent(conversation.id)}`}
                onClick={() => setActiveId(conversation.id)}
                className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{conversation.title || "Untitled chat"}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-faint">{formatRelative(conversation.updatedAt, now)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
