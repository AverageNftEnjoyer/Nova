// Voice mode (mic listening + spoken replies) is opt-in. Nova starts every app launch muted; the user
// activates voice mode by unmuting. The flag lives in sessionStorage so it survives navigating between
// pages in one window but never carries over to the next launch (localStorage would: a stale
// "unmuted" would make Nova boot listening and speaking).
const VOICE_MUTED_KEY = "nova-muted"

export function readVoiceMuted(): boolean {
  try {
    return sessionStorage.getItem(VOICE_MUTED_KEY) !== "false"
  } catch {
    return true
  }
}

export function writeVoiceMuted(muted: boolean): void {
  try {
    sessionStorage.setItem(VOICE_MUTED_KEY, String(muted))
  } catch {
    // storage unavailable: voice mode simply stays muted
  }
}
