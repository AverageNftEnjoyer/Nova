let activeAudio: HTMLAudioElement | null = null
let activeSrc: string | null = null
let activeObjectUrl: string | null = null
let stopTimer: number | null = null
let activePlayPromise: Promise<boolean> | null = null

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

/** Stops playback. Pass false to keep object URL valid (e.g. so a later user-gesture play can reuse it). */
export function stopBootMusic(shouldRevokeObjectUrl = true) {
  clearTimer()
  activePlayPromise = null
  if (activeAudio) {
    activeAudio.pause()
    activeAudio.currentTime = 0
    activeAudio.src = ""
    activeAudio = null
  }
  activeSrc = null
  if (shouldRevokeObjectUrl) revokeObjectUrl()
}

export function playBootMusic(
  src: string,
  opts?: { maxSeconds?: number | null; volume?: number; objectUrl?: string | null; allowMutedAutoplayFallback?: boolean },
): Promise<boolean> {
  if (typeof window === "undefined" || !src) return Promise.resolve(false)

  const maxSeconds = opts?.maxSeconds === undefined ? MAX_SECONDS_DEFAULT : opts.maxSeconds
  const volume = opts?.volume ?? VOLUME_DEFAULT
  const objectUrl = opts?.objectUrl ?? null
  const allowMutedAutoplayFallback = opts?.allowMutedAutoplayFallback !== false
  const limitSeconds = typeof maxSeconds === "number" && Number.isFinite(maxSeconds) && maxSeconds >= 0 ? maxSeconds : null

  if (activeAudio && activeSrc === src) {
    // If the same source is already playing or currently attempting to start,
    // don't restart it from retry loops.
    if (!activeAudio.paused) return Promise.resolve(true)
    if (activePlayPromise) return activePlayPromise
  }

  // Do not revoke the object URL if we are about to use it (e.g. tap-to-play retry after failed autoplay).
  const revokeBeforeStart = !(objectUrl && activeObjectUrl === objectUrl)
  stopBootMusic(revokeBeforeStart)

  const audio = new Audio(src)
  // Browsers may block unmuted autoplay on cold boot. Start muted, then
  // unmute immediately after playback begins.
  audio.muted = allowMutedAutoplayFallback
  audio.volume = volume
  audio.preload = "auto"
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

  const unmuteAfterStart = () => {
    if (!allowMutedAutoplayFallback) return
    window.setTimeout(() => {
      if (activeAudio !== audio) return
      audio.muted = false
      audio.volume = volume
    }, 40)
  }

  const playResult = audio.play()
  if (playResult && typeof playResult.then === "function") {
    activePlayPromise = playResult
      .then(() => {
        unmuteAfterStart()
        return true
      })
      .catch(() => {
        // Do not revoke object URL so tap-to-play can reuse the same blob URL.
        stopBootMusic(false)
        return false
      })
      .finally(() => {
        activePlayPromise = null
      })
    return activePlayPromise
  }
  unmuteAfterStart()
  activePlayPromise = null
  return Promise.resolve(true)
}
