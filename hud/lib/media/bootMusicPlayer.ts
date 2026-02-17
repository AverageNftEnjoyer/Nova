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
  opts?: { maxSeconds?: number | null; volume?: number; objectUrl?: string | null },
): Promise<boolean> {
  if (typeof window === "undefined" || !src) return Promise.resolve(false)

  const maxSeconds = opts?.maxSeconds === undefined ? MAX_SECONDS_DEFAULT : opts.maxSeconds
  const volume = opts?.volume ?? VOLUME_DEFAULT
  const objectUrl = opts?.objectUrl ?? null
  const limitSeconds = typeof maxSeconds === "number" && Number.isFinite(maxSeconds) && maxSeconds >= 0 ? maxSeconds : null

  if (activeAudio && activeSrc === src && !activeAudio.paused) {
    return Promise.resolve(true)
  }

  stopBootMusic()

  const audio = new Audio(src)
  audio.volume = volume
  activeAudio = audio
  activeSrc = src
  activeObjectUrl = objectUrl

  const stopAtLimit = () => {
    if (limitSeconds !== null && audio.currentTime >= limitSeconds) {
      stopBootMusic()
    }
  }

  const scheduleStop = () => {
    clearTimer()
    if (limitSeconds === null) return
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0
    const maxPlayMs = Math.max(0, Math.min(limitSeconds, duration || limitSeconds) * 1000)
    stopTimer = window.setTimeout(() => stopBootMusic(), maxPlayMs)
  }

  audio.addEventListener("timeupdate", stopAtLimit)
  audio.addEventListener("loadedmetadata", scheduleStop)
  audio.addEventListener("ended", () => stopBootMusic())
  const playResult = audio.play()
  if (playResult && typeof playResult.then === "function") {
    return playResult
      .then(() => true)
      .catch(() => {
        stopBootMusic()
        return false
      })
  }
  return Promise.resolve(true)
}
