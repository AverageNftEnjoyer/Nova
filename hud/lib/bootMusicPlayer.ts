let activeAudio: HTMLAudioElement | null = null
let activeSrc: string | null = null
let activeObjectUrl: string | null = null
let stopTimer: number | null = null

const MAX_SECONDS_DEFAULT = 30
const VOLUME_DEFAULT = 0.5

function clearTimer() {
  if (stopTimer !== null) {
    window.clearTimeout(stopTimer)
    stopTimer = null
  }
}

function revokeObjectUrl() {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl)
    activeObjectUrl = null
  }
}

export function stopBootMusic() {
  clearTimer()
  if (activeAudio) {
    activeAudio.pause()
    activeAudio.currentTime = 0
    activeAudio.src = ""
    activeAudio = null
  }
  activeSrc = null
  revokeObjectUrl()
}

export function playBootMusic(
  src: string,
  opts?: { maxSeconds?: number; volume?: number; objectUrl?: string | null },
) {
  if (typeof window === "undefined" || !src) return

  const maxSeconds = opts?.maxSeconds ?? MAX_SECONDS_DEFAULT
  const volume = opts?.volume ?? VOLUME_DEFAULT
  const objectUrl = opts?.objectUrl ?? null

  if (activeAudio && activeSrc === src && !activeAudio.paused) {
    return
  }

  stopBootMusic()

  const audio = new Audio(src)
  audio.volume = volume
  activeAudio = audio
  activeSrc = src
  activeObjectUrl = objectUrl

  const stopAtLimit = () => {
    if (audio.currentTime >= maxSeconds) {
      stopBootMusic()
    }
  }

  const scheduleStop = () => {
    clearTimer()
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0
    const maxPlayMs = Math.max(0, Math.min(maxSeconds, duration || maxSeconds) * 1000)
    stopTimer = window.setTimeout(() => stopBootMusic(), maxPlayMs)
  }

  audio.addEventListener("timeupdate", stopAtLimit)
  audio.addEventListener("loadedmetadata", scheduleStop)
  audio.addEventListener("ended", () => stopBootMusic())
  audio.play().catch(() => {})
}

