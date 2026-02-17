export function to12HourParts(time24: string): { text: string; meridiem: "AM" | "PM" } {
  const match = /^(\d{2}):(\d{2})$/.exec(time24)
  if (!match) return { text: "09:00", meridiem: "AM" }

  const hour24 = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour24) || !Number.isInteger(minute)) return { text: "09:00", meridiem: "AM" }

  const meridiem: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM"
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return { text: `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, meridiem }
}

export function to24Hour(text12: string, meridiem: "AM" | "PM"): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text12)
  if (!match) return null

  let hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null

  hour = hour % 12
  if (meridiem === "PM") hour += 12
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

export function normalizeTypedTime(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4)
  if (digits.length <= 2) return digits
  if (digits.length === 3) return `${digits.slice(0, 1)}:${digits.slice(1)}`
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

export function clampToValid12Hour(text: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text)
  if (!match) return text
  let hour = Number(match[1])
  let minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return text
  if (hour < 1) hour = 1
  if (hour > 12) hour = 12
  if (minute < 0) minute = 0
  if (minute > 59) minute = 59
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

export function isCompleteTypedTime(text: string): boolean {
  return /^\d{1,2}:\d{2}$/.test(text)
}

export function isLiveCommitTypedTime(text: string): boolean {
  return /^\d{2}:\d{2}$/.test(text)
}
