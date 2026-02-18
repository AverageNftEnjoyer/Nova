import type { ResponseTone } from "@/lib/userSettings"

export const GREETINGS_BY_TONE: Record<ResponseTone, string[]> = {
  neutral: [
    "Hello. What are we working on today?",
    "Good to see you. What is the plan?",
    "Ready when you are. What should we tackle?",
    "Welcome back. What can I help with today?",
    "Hi. What should we focus on first?",
    "Let's get to work.",
  ],
  enthusiastic: [
    "Welcome back! What are we building today?",
    "Let's do this, what is first on the list?",
    "Ready to move fast, what should we tackle?",
    "Great to have you here, what is the mission?",
    "All set and energized, where do we start?",
    "Let's make progress, what are we shipping today?",
  ],
  calm: [
    "Welcome back. What would you like to work on today?",
    "No rush. What should we focus on first?",
    "I'm here. Tell me what matters most right now.",
    "Let's take this one step at a time. What's first?",
    "Good to see you. What needs attention today?",
    "We can handle this smoothly. Where should we begin?",
  ],
  direct: [
    "What is the priority?",
    "What are we solving right now?",
    "Give me the first task.",
    "What needs to be done first?",
    "What is the immediate objective?",
    "Let's execute. First item?",
  ],
  relaxed: [
    "Hey, good to see you. What are we working on?",
    "All good here. What should we take on today?",
    "Whenever you're ready, what do you want to tackle?",
    "Let's ease into it. What's on your mind?",
    "We can keep it simple. What's first?",
    "Ready when you are. Where do you want to start?",
  ],
}

export function getGreetingsForTone(tone: ResponseTone): string[] {
  return GREETINGS_BY_TONE[tone]
}

export function pickGreetingForTone(tone: ResponseTone): string {
  const pool = getGreetingsForTone(tone)
  return pool[Math.floor(Math.random() * pool.length)] || GREETINGS_BY_TONE.neutral[0]
}

export const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
export const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
export const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
export const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
export const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
export const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }
