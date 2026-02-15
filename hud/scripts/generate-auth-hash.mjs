#!/usr/bin/env node
import { randomBytes, scryptSync } from "node:crypto"

const password = String(process.argv[2] || "")
if (!password || password.length < 12) {
  console.error("Usage: node scripts/generate-auth-hash.mjs \"your-strong-password\"")
  console.error("Password must be at least 12 characters.")
  process.exit(1)
}

const n = 16384
const r = 8
const p = 1
const salt = randomBytes(16)
const derived = scryptSync(password, salt, 64, { N: n, r, p })
const hash = `scrypt$${n}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`

console.log(hash)
