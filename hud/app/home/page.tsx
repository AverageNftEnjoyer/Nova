"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  PanelLeftOpen,
  PanelLeftClose,
  CalendarDays,
  Plus,
  Trash2,
  Pin,
  PinOff,
  Pencil,
  Check,
  X,
  ArrowRight,
  Mic,
  MicOff,
} from "lucide-react"
import { AnimatedOrb } from "@/components/animated-orb"
import TextType from "@/components/TextType"
import { useNovaState } from "@/lib/useNovaState"
import { ChatSidebar } from "@/components/chat-sidebar"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/lib/theme-context"
import { cn } from "@/lib/utils"
import {
  createConversation,
  saveConversations,
  loadConversations,
  setActiveId,
  generateId,
  type ChatMessage,
  type Conversation,
} from "@/lib/conversations"
import { loadUserSettings, ORB_COLORS, type OrbColor, type BackgroundType, USER_SETTINGS_UPDATED_EVENT } from "@/lib/userSettings"
import FloatingLines from "@/components/FloatingLines"
import "@/components/FloatingLines.css"

interface ScheduleItem {
  id: string
  title: string
  time: string
  done: boolean
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const GREETINGS = [
  "Hello sir, what are we working on today?",
  "Good to see you! What's on the agenda?",
  "Hey there! Ready when you are.",
  "Welcome back! What can I help with?",
  "Hi! What would you like to tackle today?",
  "Lets get to work!",
]

const SCHEDULE_KEY = "nova-home-daily-schedule-v1"
const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }

export default function HomePage() {
  const router = useRouter()
  const { theme } = useTheme()
  const isLight = theme === "light"
  const { state: novaState, connected, sendToAgent, sendGreeting, setVoicePreference, setMuted, agentMessages, clearAgentMessages } = useNovaState()
  const [isMuted, setIsMuted] = useState(false)
  const [hasAnimated, setHasAnimated] = useState(false)
  const [input, setInput] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([])
  const [welcomeMessage, setWelcomeMessage] = useState("Welcome back! What can I help with?")
  const [newEventTitle, setNewEventTitle] = useState("")
  const [newEventTime, setNewEventTime] = useState("")
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [background, setBackground] = useState<BackgroundType>("default")
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const greetingSentRef = useRef(false)

  const persistConversations = useCallback((next: Conversation[]) => {
    setConversations(next)
    saveConversations(next)
  }, [])

  const persistSchedule = useCallback((next: ScheduleItem[]) => {
    setScheduleItems(next)
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(next))
  }, [])

  useEffect(() => {
    setConversations(loadConversations())
    setHasAnimated(true)
    setWelcomeMessage(GREETINGS[Math.floor(Math.random() * GREETINGS.length)])

    const rawSchedule = localStorage.getItem(SCHEDULE_KEY)
    if (rawSchedule) {
      try {
        const parsed = JSON.parse(rawSchedule) as ScheduleItem[]
        setScheduleItems(Array.isArray(parsed) ? parsed : [])
      } catch {
        setScheduleItems([])
      }
    }

    const settings = loadUserSettings()
    setOrbColor(settings.app.orbColor)
    setBackground(settings.app.background || "default")

    // Play launch sound only once per boot session (not every home page visit)
    const alreadyPlayed = sessionStorage.getItem("nova-launch-sound-played")
    if (settings.app.soundEnabled && !alreadyPlayed) {
      sessionStorage.setItem("nova-launch-sound-played", "true")
      audioRef.current = new Audio("/sounds/launch.mp3")
      audioRef.current.volume = 0.5
      audioRef.current.play().catch(() => {})
    }

    // Load muted state from localStorage
    const savedMuted = localStorage.getItem("nova-muted") === "true"
    setIsMuted(savedMuted)

    // Mark settings as loaded so FloatingLines doesn't restart
    setSettingsLoaded(true)

    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const refresh = () => {
      const settings = loadUserSettings()
      setOrbColor(settings.app.orbColor)
      setBackground(settings.app.background || "default")
    }
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [])

  useEffect(() => {
    if (connected && !greetingSentRef.current) {
      greetingSentRef.current = true
      const settings = loadUserSettings()
      // Send voice preference to agent on connect (includes voiceEnabled)
      setVoicePreference(settings.app.ttsVoice, settings.app.voiceEnabled)
      const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
      const t = setTimeout(() => sendGreeting(greeting, settings.app.ttsVoice, settings.app.voiceEnabled), 1500)
      return () => clearTimeout(t)
    }
  }, [connected, sendGreeting, setVoicePreference])

  // Sync local muted state with agent state (only when agent confirms muted, never auto-unmute)
  useEffect(() => {
    if (novaState === "muted") {
      setIsMuted(true)
    }
    // Never auto-unmute - only user click should unmute
  }, [novaState])

  const handleMuteToggle = useCallback(() => {
    const newMuted = !isMuted
    setIsMuted(newMuted) // Immediate local update
    localStorage.setItem("nova-muted", String(newMuted)) // Persist
    setMuted(newMuted) // Send to agent
  }, [isMuted, setMuted])

  // Send muted state to agent on connect if we were muted
  useEffect(() => {
    if (connected && isMuted) {
      setMuted(true)
    }
  }, [connected, isMuted, setMuted])

  // Watch for voice-triggered messages and open chat
  const voiceConvoCreatedRef = useRef(false)
  useEffect(() => {
    // Skip greeting messages (first message after connect)
    if (agentMessages.length === 0) {
      voiceConvoCreatedRef.current = false
      return
    }

    // Check if we have a user message from voice (not from HUD)
    const voiceUserMsg = agentMessages.find(m => m.role === "user" && m.source === "voice")
    if (voiceUserMsg && !voiceConvoCreatedRef.current) {
      voiceConvoCreatedRef.current = true

      // Create conversation with voice messages
      const convo = createConversation()
      convo.messages = agentMessages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: new Date(m.ts).toISOString(),
        source: m.source || "voice",
      }))
      convo.title = voiceUserMsg.content.length > 40
        ? voiceUserMsg.content.slice(0, 40) + "..."
        : voiceUserMsg.content

      const next = [convo, ...conversations]
      persistConversations(next)
      setActiveId(convo.id)
      clearAgentMessages()
      router.push("/chat")
    }
  }, [agentMessages, conversations, persistConversations, clearAgentMessages, router])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if ((!text && attachedFiles.length === 0) || !connected) return

    const attachmentNote = attachedFiles.length
      ? `\n\nAttached files: ${attachedFiles.map((f) => f.name).join(", ")}`
      : ""
    const finalText = `${text || "Attached files"}${attachmentNote}`

    const convo = createConversation()
    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: finalText,
      createdAt: new Date().toISOString(),
      source: "agent",
    }
    convo.messages = [userMsg]
    convo.title = text
      ? text.length > 40 ? text.slice(0, 40) + "..." : text
      : attachedFiles[0]?.name || "Attached files"

    const next = [convo, ...conversations]
    persistConversations(next)
    setActiveId(convo.id)

    const settings = loadUserSettings()
    sendToAgent(finalText, settings.app.voiceEnabled, settings.app.ttsVoice)
    setInput("")
    setAttachedFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ""
    router.push("/chat")
  }, [input, attachedFiles, connected, sendToAgent, router, conversations, persistConversations])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSelectConvo = useCallback((id: string) => {
    setActiveId(id)
    router.push("/chat")
  }, [router])

  const handleNewChat = useCallback(() => {
    const fresh = createConversation()
    const next = [fresh, ...conversations]
    persistConversations(next)
    setActiveId(fresh.id)
    router.push("/chat")
  }, [conversations, persistConversations, router])

  const handleDeleteConvo = useCallback((id: string) => {
    const remaining = conversations.filter((c) => c.id !== id)
    persistConversations(remaining)
  }, [conversations, persistConversations])

  const togglePinConversation = useCallback((id: string) => {
    const next = conversations.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))
    persistConversations(next)
  }, [conversations, persistConversations])

  const handleRenameConvo = useCallback((id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    const next = conversations.map((c) =>
      c.id === id ? { ...c, title: trimmed, updatedAt: new Date().toISOString() } : c,
    )
    persistConversations(next)
  }, [conversations, persistConversations])

  const handleArchiveConvo = useCallback((id: string, archived: boolean) => {
    const next = conversations.map((c) =>
      c.id === id ? { ...c, archived, updatedAt: new Date().toISOString() } : c,
    )
    persistConversations(next)
  }, [conversations, persistConversations])

  const handlePinConvo = useCallback((id: string, pinned: boolean) => {
    const next = conversations.map((c) => (c.id === id ? { ...c, pinned } : c))
    persistConversations(next)
  }, [conversations, persistConversations])

  const beginRenameConversation = useCallback((c: Conversation) => {
    setEditingConversationId(c.id)
    setEditingTitle(c.title)
  }, [])

  const saveRenamedConversation = useCallback(() => {
    if (!editingConversationId) return
    const nextTitle = editingTitle.trim()
    if (!nextTitle) return
    const next = conversations.map((c) =>
      c.id === editingConversationId
        ? { ...c, title: nextTitle, updatedAt: new Date().toISOString() }
        : c,
    )
    persistConversations(next)
    setEditingConversationId(null)
    setEditingTitle("")
  }, [editingConversationId, editingTitle, conversations, persistConversations])

  const addScheduleEvent = useCallback(() => {
    const title = newEventTitle.trim()
    if (!title) return
    const next: ScheduleItem = {
      id: generateId(),
      title,
      time: newEventTime || "09:00",
      done: false,
    }
    persistSchedule([...scheduleItems, next])
    setNewEventTitle("")
    setNewEventTime("")
  }, [newEventTitle, newEventTime, scheduleItems, persistSchedule])

  const toggleScheduleDone = useCallback((id: string) => {
    const next = scheduleItems.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    persistSchedule(next)
  }, [scheduleItems, persistSchedule])

  const deleteScheduleEvent = useCallback((id: string) => {
    persistSchedule(scheduleItems.filter((item) => item.id !== id))
  }, [scheduleItems, persistSchedule])

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setAttachedFiles((prev) => [...prev, ...Array.from(files)])
    e.target.value = ""
  }, [])

  const removeAttachedFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const pinnedConversations = conversations
    .filter((c) => c.pinned && !c.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const unpinnedConversations = conversations
    .filter((c) => !c.pinned && !c.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)

  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
  const panelClass =
    isLight
      ? "rounded-2xl border border-[#d9e0ea] bg-white shadow-none"
      : "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-[0_20px_60px_-35px_rgba(0,245,255,0.35)]"
  const subPanelClass = isLight
    ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md"
  const missionHover = isLight
    ? "hover:bg-[#eef3fb] hover:border-[#d5dce8]"
    : "hover:bg-[#141923] hover:border-[#2b3240]"
  const orbPalette = ORB_COLORS[orbColor]
  const floatingLinesGradient = useMemo(
    () => [orbPalette.circle1, orbPalette.circle2],
    [orbPalette.circle1, orbPalette.circle2],
  )

  return (
    <div className={cn("flex h-dvh", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-[#05070a] text-slate-100")}>
      <ChatSidebar
        conversations={conversations}
        activeId={null}
        isOpen={sidebarOpen}
        onSelect={handleSelectConvo}
        onNew={handleNewChat}
        onDelete={handleDeleteConvo}
        onRename={handleRenameConvo}
        onArchive={handleArchiveConvo}
        onPin={handlePinConvo}
        onReplayBoot={() => router.push("/boot-right")}
        novaState={novaState}
        agentConnected={connected}
      />

      <div className="flex-1 relative overflow-hidden">
        {/* FloatingLines background - only render after settings loaded to prevent restart */}
        {settingsLoaded && background === "default" && (
          <div className="absolute inset-0 opacity-30 z-0">
            <FloatingLines
              linesGradient={floatingLinesGradient}
              enabledWaves={FLOATING_LINES_ENABLED_WAVES}
              lineCount={FLOATING_LINES_LINE_COUNT}
              lineDistance={FLOATING_LINES_LINE_DISTANCE}
              topWavePosition={FLOATING_LINES_TOP_WAVE_POSITION}
              middleWavePosition={FLOATING_LINES_MIDDLE_WAVE_POSITION}
              bottomWavePosition={FLOATING_LINES_BOTTOM_WAVE_POSITION}
              bendRadius={5}
              bendStrength={-0.5}
              interactive={true}
              parallax={true}
            />
          </div>
        )}
        {settingsLoaded && (
          <>
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  `radial-gradient(circle at 48% 46%, ${hexToRgba(orbPalette.circle1, 0.22)} 0%, ${hexToRgba(orbPalette.circle2, 0.18)} 28%, transparent 58%), linear-gradient(180deg, rgba(255,255,255,0.025), transparent 35%)`,
              }}
            />
            <div className="absolute inset-0 pointer-events-none">
              <div
                className="absolute top-[12%] left-[16%] h-72 w-72 rounded-full blur-[110px]"
                style={{ backgroundColor: hexToRgba(orbPalette.circle1, 0.24) }}
              />
              <div
                className="absolute bottom-[8%] right-[18%] h-80 w-80 rounded-full blur-[130px]"
                style={{ backgroundColor: hexToRgba(orbPalette.circle2, 0.22) }}
              />
            </div>
          </>
        )}

        <div className="absolute top-0 left-0 right-0 z-20 flex items-center px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              variant="ghost"
              size="icon"
              className={cn(
                "h-9 w-9 rounded-full",
                isLight
                  ? "border border-[#d9e0ea] bg-[#f4f7fd] hover:bg-[#eef3fb] text-s-70"
                  : "border border-white/10 bg-white/4 hover:bg-cyan-400/10 text-slate-300",
              )}
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </Button>
          </div>
          <div className="flex-1" />
        </div>

        <div className="relative z-10 h-full w-full px-6 pt-4 pb-6">
          <div className="grid h-full grid-cols-[minmax(0,1fr)_360px] gap-6">
            <div className="min-h-0 flex flex-col">
              <div className="flex-1 flex flex-col items-center justify-center gap-6">
                <div className={`relative h-[280px] w-[280px] ${hasAnimated ? "orb-intro" : ""}`}>
                  {settingsLoaded && (
                    <>
                      <div
                        className="absolute -inset-6 rounded-full animate-spin animation-duration-[16s]"
                        style={{ border: `1px solid ${hexToRgba(orbPalette.circle1, 0.22)}` }}
                      />
                      <div
                        className="absolute -inset-4 rounded-full"
                        style={{ boxShadow: `0 0 80px -15px ${hexToRgba(orbPalette.circle1, 0.55)}` }}
                      />
                      <AnimatedOrb size={280} palette={orbPalette} showStateLabel={false} />
                    </>
                  )}
                </div>
                <div className="text-center">
                  <p className={cn(`mt-2 text-5xl font-semibold ${hasAnimated ? "text-blur-intro" : ""}`, isLight ? "text-s-90" : "text-white")}>
                    Hi, I&apos;m Nova
                  </p>
                  <p className={cn(`mt-3 text-lg ${hasAnimated ? "text-blur-intro-delay" : ""}`, isLight ? "text-s-50" : "text-slate-400")}>
                    <TextType
                      as="span"
                      text={[welcomeMessage]}
                      typingSpeed={75}
                      pauseDuration={1500}
                      showCursor
                      cursorCharacter="_"
                      deletingSpeed={50}
                      loop={false}
                      className="inline-block"
                    />
                  </p>
                </div>
              </div>

              <div className="max-w-3xl mx-auto w-full">
                <div className="relative">
                  <div className={cn("absolute -inset-1 rounded-2xl blur-md opacity-60", isLight ? "bg-accent-10" : "bg-accent-20")} />
                  <div className={cn("relative rounded-2xl transition-colors", isLight ? "border border-[#d9e0ea] bg-white focus-within:border-accent-30" : "border border-white/10 bg-black/40 backdrop-blur-xl focus-within:border-accent-30")}>
                    {attachedFiles.length > 0 && (
                      <div className="px-4 pt-3 flex flex-wrap gap-2">
                        {attachedFiles.map((file, index) => (
                          <div key={`${file.name}-${file.size}-${index}`} className="inline-flex items-center gap-1.5 rounded-md border border-accent-30 bg-accent-10 px-2 py-1 max-w-55">
                            <span className="truncate text-xs text-accent">{file.name}</span>
                            <button
                              onClick={() => removeAttachedFile(index)}
                              className="h-4 w-4 rounded-sm text-accent hover:bg-accent-20 transition-colors"
                              aria-label={`Remove ${file.name}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={handleAttachClick}
                      className={cn(
                        "group absolute left-4 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md text-2xl leading-none transition-all duration-150",
                        isLight ? "text-s-50 hover:bg-accent-10 hover:rotate-12" : "text-slate-400 hover:bg-accent-10 hover:rotate-12",
                      )}
                      aria-label="Attach files"
                    >
                      <span
                        className={cn(
                          "pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                          isLight ? "border border-[#d9e0ea] bg-white text-s-60" : "border border-white/10 bg-[#0e1320] text-slate-300",
                        )}
                      >
                        Add your files
                      </span>
                      +
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      multiple
                      onChange={handleFileChange}
                    />
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={connected ? "Enter your command..." : "Waiting for agent..."}
                      disabled={!connected}
                      rows={1}
                      className={cn("w-full bg-transparent text-sm pl-12 pt-4.5 pb-2.5 pr-24 resize-none outline-none disabled:opacity-40", isLight ? "text-s-90 placeholder:text-s-30" : "text-slate-100 placeholder:text-slate-500")}
                      style={{ maxHeight: 120 }}
                    />
                    <div className="absolute right-3 bottom-3 flex items-center gap-2">
                      <button
                        onClick={handleSend}
                        disabled={(!input.trim() && attachedFiles.length === 0) || !connected}
                        className={cn(
                          "group p-1.5 transition-colors disabled:opacity-20",
                          isLight ? "text-s-60 hover:text-accent" : "text-slate-400 hover:text-accent",
                        )}
                        aria-label="Send message"
                      >
                        <ArrowRight className="w-5 h-5 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
                      </button>
                      <button
                        onClick={handleMuteToggle}
                        className={cn(
                          "group relative h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150 hover:rotate-12",
                          isMuted
                            ? "text-red-400 hover:text-red-300"
                            : "border border-accent-30 bg-accent-10 hover:bg-accent-20 text-accent"
                        )}
                        aria-label={isMuted ? "Unmute Nova" : "Mute Nova"}
                      >
                        <span
                          className={cn(
                            "pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                            isLight ? "border border-[#d9e0ea] bg-white text-s-60" : "border border-white/10 bg-[#0e1320] text-slate-300",
                          )}
                        >
                          Mute Nova From Listening
                        </span>
                        {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <aside className="min-h-0 flex flex-col gap-4 pt-0">
              <section className={`${panelClass} p-4`}>
                <div className="flex items-center gap-2 text-s-80">
                  <CalendarDays className="w-4 h-4 text-accent" />
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Daily Schedule</h2>
                </div>
                <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>{dateLabel}</p>

                <div className="mt-3 grid grid-cols-[88px_minmax(0,1fr)_32px] gap-2">
                  <input
                    type="time"
                    value={newEventTime}
                    onChange={(e) => setNewEventTime(e.target.value)}
                    className={cn(`h-9 px-2 text-xs outline-none focus:border-accent-30 ${subPanelClass}`, isLight ? "text-s-90" : "text-slate-200")}
                  />
                  <input
                    type="text"
                    value={newEventTitle}
                    onChange={(e) => setNewEventTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addScheduleEvent()
                    }}
                    placeholder="Add event..."
                    className={cn(`h-9 px-3 text-sm outline-none focus:border-accent-30 ${subPanelClass}`, isLight ? "text-s-90 placeholder:text-s-30" : "text-slate-100 placeholder:text-slate-500")}
                  />
                  <button
                    onClick={addScheduleEvent}
                    className={cn("h-9 rounded-lg transition-colors border border-accent-30 bg-accent-10 text-accent hover:bg-accent-20")}
                    aria-label="Add schedule item"
                  >
                    <Plus className="w-4 h-4 mx-auto" />
                  </button>
                </div>

                <div className="mt-3 max-h-44 overflow-y-auto space-y-2 pr-1">
                  {scheduleItems.length === 0 && (
                    <p className={cn("text-xs", isLight ? "text-s-40" : "text-slate-500")}>No events for today.</p>
                  )}
                  {scheduleItems.map((item) => (
                    <div key={item.id} className={`flex items-center gap-2 px-2.5 py-2 ${subPanelClass}`}>
                      <button
                        onClick={() => toggleScheduleDone(item.id)}
                        className={`h-4 w-4 rounded border ${item.done ? "bg-emerald-400/80 border-emerald-300/80" : "border-slate-500/70"}`}
                        aria-label={item.done ? "Mark incomplete" : "Mark complete"}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs ${item.done ? "text-s-30 line-through" : isLight ? "text-s-60" : "text-slate-300"}`}>{item.time}</p>
                        <p className={`text-sm truncate ${item.done ? "text-s-30 line-through" : isLight ? "text-s-90" : "text-slate-100"}`}>{item.title}</p>
                      </div>
                      <button
                        onClick={() => deleteScheduleEvent(item.id)}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                        aria-label="Delete event"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className={`${panelClass} p-4 min-h-0 flex-1 flex flex-col`}>
                <div className="flex items-center gap-2 text-s-80">
                  <Pin className="w-4 h-4 text-accent" />
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Mission Pipeline</h2>
                </div>
                <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>Pinned favorite chats</p>

                <div className="mt-3 min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
                  {pinnedConversations.length === 0 && (
                    <p className={cn("text-xs", isLight ? "text-s-40" : "text-slate-500")}>No pinned chats yet.</p>
                  )}
                  {pinnedConversations.map((c) => (
                    <div key={c.id} className={cn(`${subPanelClass} p-2.5 transition-colors`, missionHover)}>
                      {editingConversationId === c.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveRenamedConversation()
                              if (e.key === "Escape") {
                                setEditingConversationId(null)
                                setEditingTitle("")
                              }
                            }}
                            className={cn("h-8 flex-1 rounded-md px-2 text-sm outline-none focus:border-accent-30", isLight ? "border border-s-10 bg-white text-s-90" : "border border-white/10 bg-black/35 text-slate-100")}
                            autoFocus
                          />
                          <button
                            onClick={saveRenamedConversation}
                            className="p-1.5 rounded-md text-emerald-300 hover:bg-emerald-500/10"
                            aria-label="Save title"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingConversationId(null)
                              setEditingTitle("")
                            }}
                            className="p-1.5 rounded-md text-slate-400 hover:bg-white/10"
                            aria-label="Cancel rename"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleSelectConvo(c.id)}
                            className={cn("flex-1 text-left text-sm truncate transition-colors", isLight ? "text-s-90 hover:text-accent" : "text-slate-100 hover:text-s-90")}
                            title={c.title}
                          >
                            {c.title}
                          </button>
                          <button
                            onClick={() => beginRenameConversation(c)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/10"
                            aria-label="Rename chat"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => togglePinConversation(c.id)}
                            className="p-1.5 rounded-md text-accent hover:bg-accent-10"
                            aria-label="Unpin chat"
                          >
                            <PinOff className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {unpinnedConversations.length > 0 && (
                    <div className="pt-2 mt-3 border-t border-white/10">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500 mb-2">Pin from recent</p>
                      <div className="space-y-2">
                        {unpinnedConversations.map((c) => (
                          <div key={c.id} className={cn(`flex items-center gap-2 px-2.5 py-2 ${subPanelClass} transition-colors`, missionHover)}>
                            <button
                              onClick={() => handleSelectConvo(c.id)}
                              className={cn("flex-1 min-w-0 text-left text-sm truncate", isLight ? "text-s-70 hover:text-s-90" : "text-slate-300 hover:text-white")}
                            >
                              {c.title}
                            </button>
                            <button
                              onClick={() => togglePinConversation(c.id)}
                              className="p-1.5 rounded-md text-s-40 hover:text-accent hover:bg-accent-10"
                              aria-label="Pin chat"
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
