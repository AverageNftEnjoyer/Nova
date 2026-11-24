"use client"

import * as React from "react"
import { Archive, ArchiveRestore, ChevronRight, MoreHorizontal, PanelLeftClose, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { DEFAULT_CONVERSATION_TITLE, type Conversation } from "@/lib/chat/conversations"
import {
  Button,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  IconButton,
  Input,
  SearchInput,
  Tooltip,
} from "@/components/ui"

export interface ChatSidebarProps {
  conversations: Conversation[]
  activeId: string | null
  /** When false the panel is not rendered (collapsed). */
  isOpen: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename?: (id: string, title: string) => void
  onArchive?: (id: string, archived: boolean) => void
  onPin?: (id: string, pinned: boolean) => void
  /** Shows a collapse button in the panel header. */
  onCollapse?: () => void
  className?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function formatRelative(iso: string, now: number): string {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return ""
  const diff = Math.max(0, now - time)
  if (diff < 60_000) return "now"
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < DAY_MS) return `${Math.floor(diff / (60 * 60_000))}h`
  if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)}d`
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** Threads still on the auto-generated default title read as "New chat", matching the conversation header. */
export function threadDisplayTitle(convo: Conversation): string {
  const title = convo.title.trim()
  return !title || title === DEFAULT_CONVERSATION_TITLE ? "New chat" : title
}

function matchesQuery(convo: Conversation, query: string): boolean {
  if (!query) return true
  if (threadDisplayTitle(convo).toLowerCase().includes(query)) return true
  return convo.messages.some((message) => message.content.toLowerCase().includes(query))
}

/** Thread list for the chat workspace: search, pinned / recent / archived groups, row menu, keyboard navigation. */
export function ChatSidebar({
  conversations,
  activeId,
  isOpen,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onArchive,
  onPin,
  onCollapse,
  className,
}: ChatSidebarProps) {
  const [query, setQuery] = React.useState("")
  const [archivedOpen, setArchivedOpen] = React.useState(false)
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameDraft, setRenameDraft] = React.useState("")
  const [pendingDelete, setPendingDelete] = React.useState<Conversation | null>(null)
  const [now, setNow] = React.useState(() => Date.now())
  const listRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const normalizedQuery = query.trim().toLowerCase()
  const groups = React.useMemo(() => {
    const sorted = [...conversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    const visible = sorted.filter((c) => matchesQuery(c, normalizedQuery))
    return {
      pinned: visible.filter((c) => !c.archived && c.pinned),
      recent: visible.filter((c) => !c.archived && !c.pinned),
      archived: visible.filter((c) => c.archived),
    }
  }, [conversations, normalizedQuery])

  if (!isOpen) return null

  const showArchived = archivedOpen || (normalizedQuery.length > 0 && groups.archived.length > 0)
  const nothingMatches =
    normalizedQuery.length > 0 && groups.pinned.length + groups.recent.length + groups.archived.length === 0

  const beginRename = (convo: Conversation) => {
    setRenamingId(convo.id)
    setRenameDraft(convo.title)
  }

  const finishRename = (commit: boolean) => {
    const id = renamingId
    const next = renameDraft.trim()
    setRenamingId(null)
    setRenameDraft("")
    if (commit && id && next && onRename) onRename(id, next)
    window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(id ?? "")}"]`)?.focus()
    })
  }

  // Arrow keys move between thread rows; F2 renames, Delete asks to delete.
  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (!target.matches("[data-thread-id]")) return
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-thread-id]") ?? [])
    const index = rows.indexOf(target)
    const focusRow = (next: number) => {
      event.preventDefault()
      rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus()
    }
    const convo = conversations.find((c) => c.id === target.dataset.threadId)
    if (event.key === "ArrowDown") focusRow(index + 1)
    else if (event.key === "ArrowUp") focusRow(index - 1)
    else if (event.key === "Home") focusRow(0)
    else if (event.key === "End") focusRow(rows.length - 1)
    else if (event.key === "F2" && convo && onRename) {
      event.preventDefault()
      beginRename(convo)
    } else if (event.key === "Delete" && convo) {
      event.preventDefault()
      setPendingDelete(convo)
    }
  }

  const renderRow = (convo: Conversation) => {
    const active = convo.id === activeId
    if (renamingId === convo.id) {
      return (
        <div key={convo.id} className="px-1 py-0.5">
          <Input
            autoFocus
            size="sm"
            value={renameDraft}
            aria-label="Thread name"
            onChange={(event) => setRenameDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") finishRename(true)
              if (event.key === "Escape") {
                event.stopPropagation()
                finishRename(false)
              }
            }}
            onBlur={() => finishRename(true)}
          />
        </div>
      )
    }
    return (
      <div key={convo.id} className="group/thread relative">
        <button
          type="button"
          data-thread-id={convo.id}
          aria-current={active ? "true" : undefined}
          onClick={() => onSelect(convo.id)}
          className={cn(
            "relative flex h-8 w-full items-center gap-2 rounded-md pl-2.5 pr-9 text-left text-sm transition-colors duration-150",
            "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg",
          )}
        >
          {active ? <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" /> : null}
          <span className="min-w-0 flex-1 truncate">{threadDisplayTitle(convo)}</span>
          <span className="shrink-0 font-mono text-2xs tabular-nums text-faint group-hover/thread:invisible group-focus-within/thread:invisible">
            {formatRelative(convo.updatedAt, now)}
          </span>
        </button>
        <div className="absolute inset-y-0 right-1 flex items-center opacity-0 transition-opacity duration-150 group-hover/thread:opacity-100 group-focus-within/thread:opacity-100 has-data-[state=open]:opacity-100">
          <ThreadMenu
            convo={convo}
            onRename={onRename ? () => beginRename(convo) : undefined}
            onArchive={onArchive}
            onPin={onPin}
            onDelete={() => setPendingDelete(convo)}
          />
        </div>
      </div>
    )
  }

  const renderGroup = (label: string, items: Conversation[]) =>
    items.length === 0 ? null : (
      <section aria-label={label} className="mb-3">
        <h3 className="px-2.5 pb-1 text-xs font-medium text-faint">{label}</h3>
        <div className="space-y-px">{items.map(renderRow)}</div>
      </section>
    )

  return (
    <aside aria-label="Chat threads" className={cn("flex h-full min-h-0 w-64 shrink-0 flex-col border-r border-border bg-surface", className)}>
      <div className="flex h-11 shrink-0 items-center gap-1 pl-3 pr-1.5">
        <h2 className="flex-1 text-md font-medium text-fg">Threads</h2>
        <Tooltip content="New chat">
          <IconButton size="sm" aria-label="New chat" onClick={onNew}>
            <Plus />
          </IconButton>
        </Tooltip>
        {onCollapse ? (
          <Tooltip content="Hide threads">
            <IconButton size="sm" aria-label="Hide threads" onClick={onCollapse}>
              <PanelLeftClose />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
      <div className="shrink-0 px-2 pb-2">
        <SearchInput size="sm" value={query} onValueChange={setQuery} placeholder="Search threads" />
      </div>

      <div ref={listRef} onKeyDown={handleListKeyDown} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 pt-1">
        {conversations.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-muted">No threads yet. Start one with New chat.</p>
        ) : nothingMatches ? (
          <p className="px-2.5 py-2 text-xs text-muted">No threads match &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          <>
            {renderGroup("Pinned", groups.pinned)}
            {renderGroup("Recent", groups.recent)}
            {groups.archived.length > 0 ? (
              <section aria-label="Archived" className="mb-3">
                <button
                  type="button"
                  aria-expanded={showArchived}
                  onClick={() => setArchivedOpen((open) => !open)}
                  className="flex h-6 w-full items-center gap-1 rounded-md px-2.5 text-xs font-medium text-faint transition-colors hover:text-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ChevronRight className={cn("size-3 transition-transform duration-150", showArchived && "rotate-90")} aria-hidden />
                  Archived
                  <span className="ml-auto font-mono text-2xs tabular-nums">{groups.archived.length}</span>
                </button>
                {showArchived ? <div className="mt-1 space-y-px">{groups.archived.map(renderRow)}</div> : null}
              </section>
            ) : null}
          </>
        )}
      </div>

      <DeleteThreadDialog
        convo={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={(id) => {
          setPendingDelete(null)
          onDelete(id)
        }}
      />
    </aside>
  )
}

export interface ThreadMenuProps {
  convo: Conversation
  onRename?: () => void
  onArchive?: (id: string, archived: boolean) => void
  onPin?: (id: string, pinned: boolean) => void
  onDelete: () => void
  /** Trigger size; the conversation header uses md. */
  size?: "sm" | "md"
  align?: "start" | "end"
}

/** Rename / pin / archive / delete menu for one thread (row menu and conversation header). */
export function ThreadMenu({ convo, onRename, onArchive, onPin, onDelete, size = "sm", align = "end" }: ThreadMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size={size} aria-label={`Thread options for ${threadDisplayTitle(convo)}`} className="data-[state=open]:bg-active data-[state=open]:text-fg">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} sideOffset={4} className="w-44">
        {onRename ? (
          <DropdownMenuItem onSelect={onRename}>
            <Pencil />
            Rename
            <DropdownMenuShortcut>F2</DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}
        {onPin && !convo.archived ? (
          <DropdownMenuItem onSelect={() => onPin(convo.id, !convo.pinned)}>
            {convo.pinned ? <PinOff /> : <Pin />}
            {convo.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
        ) : null}
        {onArchive ? (
          <DropdownMenuItem onSelect={() => onArchive(convo.id, !convo.archived)}>
            {convo.archived ? <ArchiveRestore /> : <Archive />}
            {convo.archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Delete
          <DropdownMenuShortcut>Del</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Confirmation before a thread and its messages are deleted. Open while `convo` is set. */
export function DeleteThreadDialog({
  convo,
  onCancel,
  onConfirm,
}: {
  convo: Conversation | null
  onCancel: () => void
  onConfirm: (id: string) => void
}) {
  return (
    <Dialog open={convo !== null} onOpenChange={(open) => !open && onCancel()} size="sm">
      <DialogHeader>
        <DialogTitle>Delete thread?</DialogTitle>
        <DialogDescription>
          &ldquo;{convo ? threadDisplayTitle(convo) : ""}&rdquo; and all of its messages are deleted from Nova. This cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" data-autofocus onClick={() => convo && onConfirm(convo.id)}>
          Delete thread
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Rename a thread from outside the list (the conversation header). Open while `convo` is set. */
export function RenameThreadDialog({
  convo,
  onCancel,
  onRename,
}: {
  convo: Conversation | null
  onCancel: () => void
  onRename: (id: string, title: string) => void
}) {
  const [draft, setDraft] = React.useState("")
  React.useEffect(() => {
    if (convo) setDraft(convo.title)  
  }, [convo])
  const submit = () => {
    const next = draft.trim()
    if (!convo || !next) return
    onRename(convo.id, next)
  }
  return (
    <Dialog open={convo !== null} onOpenChange={(open) => !open && onCancel()} size="sm" dismissible={false}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <DialogHeader>
          <DialogTitle>Rename thread</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Input
            data-autofocus
            aria-label="Thread name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!draft.trim()}>
            Rename
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
