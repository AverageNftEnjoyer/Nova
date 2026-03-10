import assert from "node:assert/strict"
import test from "node:test"

import { GmailServiceError } from "../../gmail/errors.ts"
import { shouldFallbackToPrimaryCalendar } from "../events/index.ts"

test("shouldFallbackToPrimaryCalendar: true for 403 Gmail service errors", () => {
  const err = new GmailServiceError("gmail.forbidden", "Forbidden", { status: 403 })
  assert.equal(shouldFallbackToPrimaryCalendar(err), true)
})

test("shouldFallbackToPrimaryCalendar: true for 401 Gmail service errors", () => {
  const err = new GmailServiceError("gmail.unauthorized", "Unauthorized", { status: 401 })
  assert.equal(shouldFallbackToPrimaryCalendar(err), true)
})

test("shouldFallbackToPrimaryCalendar: true for insufficient scope message", () => {
  const err = new Error("Request had insufficient authentication scopes.")
  assert.equal(shouldFallbackToPrimaryCalendar(err), true)
})

test("shouldFallbackToPrimaryCalendar: false for non-auth failures", () => {
  const err = new GmailServiceError("gmail.transient", "Upstream timeout", { status: 503 })
  assert.equal(shouldFallbackToPrimaryCalendar(err), false)
})

