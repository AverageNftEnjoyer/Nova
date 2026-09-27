"use client"

import { useState } from "react"
import { Archive, ChevronDown, ChevronRight, FolderArchive, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import type { Conversation } from "@/lib/chat/conversations"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/shared/utils"

interface HistoryConversationMenuProps {
  conversation: Conversation
  isLight: boolean
  onRename: (conversation: Conversation) => void
  onArchive: (id: string, archived: boolean) => void
  onDelete: (id: string) => void
}

function HistoryConversationMenu({
  conversation,
  isLight,
  onRename,
  onArchive,
  onDelete,
}: HistoryConversationMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "h-5 w-5 shrink-0 rounded-md flex items-center justify-center transition-all duration-150 text-s-40",
            isLight ? "hover:bg-[#eef3fb] hover:text-accent" : "hover:bg-white/8 hover:text-accent",
          )}
          aria-label="Conversation options"
          title="Conversation options"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className={cn(
          "rounded-xl p-1.5 min-w-[180px] backdrop-blur-xl",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          isLight
            ? "!border-[#d5dce8] !bg-[#f4f7fd]/95 !shadow-[0_10px_30px_-12px_rgba(15,23,42,0.25)]"
            : "!border-white/10 !bg-black/25 !shadow-[0_14px_34px_-14px_rgba(0,0,0,0.55)]",
        )}
      >
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation()
            onRename(conversation)
          }}
          className={cn(
            "home-spotlight-card home-border-glow home-spotlight-card--hover rounded-lg px-3 py-2.5 text-sm gap-3 cursor-pointer font-medium transition-all duration-150",
            isLight
              ? "text-s-70 data-highlighted:bg-accent data-highlighted:!text-white"
              : "text-s-60 data-highlighted:bg-accent/90 data-highlighted:!text-white",
          )}
        >
          <Pencil className="w-4 h-4 opacity-70" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation()
            onArchive(conversation.id, !conversation.archived)
          }}
          className={cn(
            "home-spotlight-card home-border-glow home-spotlight-card--hover rounded-lg px-3 py-2.5 text-sm gap-3 cursor-pointer font-medium transition-all duration-150",
            isLight
              ? "text-s-70 data-highlighted:bg-accent data-highlighted:!text-white"
              : "text-s-60 data-highlighted:bg-accent/90 data-highlighted:!text-white",
          )}
        >
          <Archive className="w-4 h-4 opacity-70" />
          {conversation.archived ? "Unarchive" : "Archive"}
        </DropdownMenuItem>
        <div className={cn("my-1.5 h-px", isLight ? "bg-[#e5e9f0]" : "bg-white/[0.06]")} />
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation()
            onDelete(conversation.id)
          }}
          variant="destructive"
          className="rounded-lg px-3 py-2.5 text-sm gap-3 cursor-pointer font-medium !text-red-400 data-highlighted:bg-red-500/10 data-highlighted:!text-red-400 [&_svg]:!text-red-400 transition-all duration-150"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface ChatHistoryModuleProps {
  isLight: boolean
  subPanelClass: string
  conversations: Conversation[]
  onSelect: (id: string) => void
  onNewChat: () => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string, archived: boolean) => void
  onDelete: (id: string) => void
}

/** Chat history: new chat, active and archived conversations with rename / archive / delete. */
export function ChatHistoryModule({
  isLight,
  subPanelClass,
  conversations,
  onSelect,
  onNewChat,
  onRename,
  onArchive,
  onDelete,
}: ChatHistoryModuleProps) {
  const [chatsOpen, setChatsOpen] = useState(true)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingTitle, setRenamingTitle] = useState("")

  const activeConversations = conversations.filter((conversation) => !conversation.archived)
  const archivedConversations = conversations.filter((conversation) => conversation.archived)

  const beginRename = (conversation: Conversation) => {
    setRenamingId(conversation.id)
    setRenamingTitle(String(conversation.title || "").trim() || "New Chat")
  }

  const saveRename = () => {
    const next = renamingTitle.trim()
    if (renamingId && next) onRename(renamingId, next)
    setRenamingId(null)
    setRenamingTitle("")
  }

  const renderRow = (conversation: Conversation) => (
    <div
      key={conversation.id}
      className={cn("group flex items-center gap-1 border px-2.5 py-1 transition-colors home-spotlight-card home-border-glow", subPanelClass)}
    >
      <button type="button" onClick={() => onSelect(conversation.id)} className="min-w-0 flex-1 text-left">
        {renamingId === conversation.id ? (
          <input
            autoFocus
            value={renamingTitle}
            onChange={(event) => setRenamingTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveRename()
              if (event.key === "Escape") {
                setRenamingId(null)
                setRenamingTitle("")
              }
            }}
            onBlur={saveRename}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "w-full border px-2 py-0.5 text-[13px] leading-5 outline-none",
              isLight ? "border-[#cfd9e9] bg-white text-s-90" : "border-white/10 bg-black/20 text-slate-100",
            )}
          />
        ) : (
          <p className={cn("truncate text-[13px] leading-5", isLight ? "text-s-90" : "text-slate-100")}>
            {String(conversation.title || "New Chat").trim() || "New Chat"}
          </p>
        )}
      </button>
      {renamingId !== conversation.id ? (
        <HistoryConversationMenu conversation={conversation} isLight={isLight} onRename={beginRename} onArchive={onArchive} onDelete={onDelete} />
      ) : null}
    </div>
  )

  const renderGroup = (
    label: string,
    icon: React.ReactNode,
    open: boolean,
    toggle: () => void,
    items: Conversation[],
    empty: string,
  ) => (
    <div>
      <button
        type="button"
        onClick={toggle}
        className={cn("flex w-full items-center gap-1.5 px-1 py-1 text-[12px] uppercase tracking-[0.12em]", isLight ? "text-s-60" : "text-slate-300")}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {icon}
        {label}
        <span className={cn("ml-auto text-[12px]", isLight ? "text-s-50" : "text-slate-400")}>{items.length}</span>
      </button>
      {open ? (
        <div className="mt-1 space-y-1">
          {items.length === 0 ? (
            <p className={cn("px-2 py-2 text-[13px]", isLight ? "text-s-40" : "text-slate-500")}>{empty}</p>
          ) : (
            items.map(renderRow)
          )}
        </div>
      ) : null}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={onNewChat}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 border px-2.5 py-1.5 text-[13px] transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover",
          subPanelClass,
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        New Chat
      </button>
      <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 module-hover-scroll">
        {conversations.length === 0 ? (
          <div className={cn("border p-2.5 text-[13px] leading-5", subPanelClass)}>
            No conversations yet. Start a new chat to open the full chat page.
          </div>
        ) : (
          <>
            {renderGroup("Chats", <FolderOpen className="h-3.5 w-3.5 text-accent" />, chatsOpen, () => setChatsOpen((v) => !v), activeConversations, "No active chats.")}
            {renderGroup("Archived", <FolderArchive className="h-3.5 w-3.5 text-accent" />, archivedOpen, () => setArchivedOpen((v) => !v), archivedConversations, "No archived chats.")}
          </>
        )}
      </div>
    </div>
  )
}
