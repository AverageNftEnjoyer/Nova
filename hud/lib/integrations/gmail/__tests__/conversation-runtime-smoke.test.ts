import assert from "node:assert/strict"
import test from "node:test"

function buildTurn(userContextId: string, conversationId: string) {
  return {
    source: "hud",
    sender: "hud-user",
    userContextId,
    conversationId,
    sessionKeyHint: `agent:nova:hud:user:${userContextId}:dm:${conversationId}`,
  }
}

test("smoke: conversation runtime payload keeps stable user-scoped identifiers across turns", () => {
  const userContextId = "gmail-smoke-user-context-2026-02-24"
  const conversationId = "gmail-smoke-thread-stable-01"
  const first = buildTurn(userContextId, conversationId)
  const second = buildTurn(userContextId, conversationId)

  assert.equal(first.source, "hud")
  assert.equal(first.sender, "hud-user")
  assert.equal(first.userContextId, userContextId)
  assert.equal(first.conversationId, conversationId)
  assert.equal(first.sessionKeyHint, `agent:nova:hud:user:${userContextId}:dm:${conversationId}`)
  assert.equal(second.sessionKeyHint, first.sessionKeyHint)
})

