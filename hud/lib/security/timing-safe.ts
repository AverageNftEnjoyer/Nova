import "server-only"

import { timingSafeEqual } from "node:crypto"

function toBuffer(value: string): Buffer {
  return Buffer.from(String(value || ""), "utf8")
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const left = toBuffer(a)
  const right = toBuffer(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
