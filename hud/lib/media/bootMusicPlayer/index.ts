let activeAudio: HTMLAudioElement | null = null
let activeSrc: string | null = null
let activeObjectUrl: string | null = null
let stopTimer: number | null = null
let activePlayPromise: Promise<boolean> | null = null
let fadeTimer: number | null = null

const MAX_SECONDS_DEFAULT = 30
const VOLUME_DEFAULT = 0.5
const FADE_MS_DEFAULT = 420
const FADE_TICK_MS = 40

export type BootMusicDiagnostic = {
  stage:
    | "skip"
    | "start"
    | "play-promise"
    | "play-success"
    | "play-failed"
    | "stop-at-limit"
    | "stop-at-ended"
    | "schedule-stop"
  reason: string
  srcKind: "data-url" | "object-url" | "remote-url" | "other"
  errorName?: string
  errorMessage?: string
}

function classifySrcKind(src: string): BootMusicDiagnostic["srcKind"] {
  if (!src) return "other"
  if (src.startsWith("data:")) return "data-url"
  if (src.startsWith("blob:")) return "object-url"
  if (/^https?:\/\//i.test(src)) return "remote-url"
  return "other"
}

function clearTimer() {
  if (stopTimer !== null) {
    window.clearTimeout(stopTimer)
    stopTimer = null
  }
}

function clearFadeTimer() {
  if (fadeTimer !== null) {
    window.clearInterval(fadeTimer)
    fadeTimer = null
  }
}

/** Stops playback. Pass false to keep object URL valid (e.g. so a later user-gesture play can reuse it). */
export function stopBootMusic(
  shouldRevokeObjectUrl = true,
  opts?: { immediate?: boolean; fadeMs?: number },
) {
  clearTimer()
  clearFadeTimer()
  activePlayPromise = null

  const audioToStop = activeAudio
  const objectUrlToRevoke = shouldRevokeObjectUrl ? activeObjectUrl : null
  activeAudio = null
  activeSrc = null
  activeObjectUrl = shouldRevokeObjectUrl ? null : activeObjectUrl

  if (!audioToStop) {
    if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke)
    return
  }

  const immediate = opts?.immediate === true
  const fadeMs = opts?.fadeMs ?? FADE_MS_DEFAULT
  const startVolume = Number.isFinite(audioToStop.volume) ? Math.max(0, audioToStop.volume) : 0
  const shouldFade = !immediate && !audioToStop.paused && !audioToStop.muted && startVolume > 0 && fadeMs > 0

  const finalize = () => {
    audioToStop.pause()
    audioToStop.currentTime = 0
    audioToStop.src = ""
    if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke)
  }

  if (!shouldFade) {
    finalize()
    return
  }

  const steps = Math.max(1, Math.round(fadeMs / FADE_TICK_MS))
  let tick = 0
  fadeTimer = window.setInterval(() => {
    tick += 1
    const ratio = Math.max(0, 1 - tick / steps)
    audioToStop.volume = Math.max(0, startVolume * ratio)
    if (tick >= steps) {
      clearFadeTimer()
      finalize()
    }
  }, FADE_TICK_MS)
}

export function playBootMusic(
  src: string,
  opts?: {
    maxSeconds?: number | null
    volume?: number
    objectUrl?: string | null
    allowMutedAutoplayFallback?: boolean
    onDiagnostic?: (entry: BootMusicDiagnostic) => void
  },
): Promise<boolean> {
  const srcKind = classifySrcKind(src)
  const emit = (entry: Omit<BootMusicDiagnostic, "srcKind">) => {
    opts?.onDiagnostic?.({ ...entry, srcKind })
  }

  if (typeof window === "undefined" || !src) {
    emit({ stage: "skip", reason: "missing-window-or-src" })
    return Promise.resolve(false)
  }

  const maxSeconds = opts?.maxSeconds === undefined ? MAX_SECONDS_DEFAULT : opts.maxSeconds
  const volume = opts?.volume ?? VOLUME_DEFAULT
  const objectUrl = opts?.objectUrl ?? null
  const allowMutedAutoplayFallback = opts?.allowMutedAutoplayFallback !== false
  const limitSeconds = typeof maxSeconds === "number" && Number.isFinite(maxSeconds) && maxSeconds >= 0 ? maxSeconds : null

  if (activeAudio && activeSrc === src) {
    // If the same source is already playing or currently attempting to start,
    // don't restart it from retry loops.
    if (!activeAudio.paused) {
      emit({ stage: "skip", reason: "already-playing-same-src" })
      return Promise.resolve(true)
    }
    if (activePlayPromise) {
      emit({ stage: "skip", reason: "play-in-flight-same-src" })
      return activePlayPromise
    }
  }

  // Do not revoke the object URL if we are about to use it (e.g. tap-to-play retry after failed autoplay).
  const revokeBeforeStart = !(objectUrl && activeObjectUrl === objectUrl)
  stopBootMusic(revokeBeforeStart, { immediate: true })

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
      emit({ stage: "stop-at-limit", reason: "max-seconds-reached" })
      stopBootMusic()
    }
  }

  const scheduleStop = () => {
    clearTimer()
    if (limitSeconds === null) return
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0
    const maxPlayMs = Math.max(0, Math.min(limitSeconds, duration || limitSeconds) * 1000)
    emit({ stage: "schedule-stop", reason: `timer-ms:${maxPlayMs}` })
    stopTimer = window.setTimeout(() => stopBootMusic(), maxPlayMs)
  }

  audio.addEventListener("timeupdate", stopAtLimit)
  audio.addEventListener("loadedmetadata", scheduleStop)
  audio.addEventListener("ended", () => {
    emit({ stage: "stop-at-ended", reason: "audio-ended" })
    stopBootMusic()
  })

  const unmuteAfterStart = () => {
    if (!allowMutedAutoplayFallback) return
    window.setTimeout(() => {
      if (activeAudio !== audio) return
      audio.muted = false
      audio.volume = volume
    }, 40)
  }

  emit({ stage: "start", reason: "audio-play-invoked" })
  const playResult = audio.play()
  if (playResult && typeof playResult.then === "function") {
    emit({ stage: "play-promise", reason: "play-returned-promise" })
    activePlayPromise = playResult
      .then(() => {
        emit({ stage: "play-success", reason: "playback-started" })
        unmuteAfterStart()
        return true
      })
      .catch((error: unknown) => {
        const errorName = typeof error === "object" && error && "name" in error ? String((error as { name?: unknown }).name ?? "") : undefined
        const errorMessage = typeof error === "object" && error && "message" in error ? String((error as { message?: unknown }).message ?? "") : undefined
        emit({ stage: "play-failed", reason: "audio-play-rejected", errorName, errorMessage })
        // Do not revoke object URL so tap-to-play can reuse the same blob URL.
        stopBootMusic(false)
        return false
      })
      .finally(() => {
        activePlayPromise = null
      })
    return activePlayPromise
  }
  emit({ stage: "play-success", reason: "playback-started-sync" })
  unmuteAfterStart()
  activePlayPromise = null
  return Promise.resolve(true)
}
