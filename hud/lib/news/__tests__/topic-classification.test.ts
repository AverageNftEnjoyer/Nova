import assert from "node:assert/strict"
import test from "node:test"

import {
  matchesRequestedNewsTopics,
  resolveNewsArticleClassification,
} from "../topic-classification.ts"

test("finance article mislabeled by upstream metadata no longer matches sports", () => {
  const classification = resolveNewsArticleClassification({
    title: "Critical Analysis: Dakota Active Equity ETF (NASDAQ:DAK) and Bel Fuse (NASDAQ:BELFA)",
    summary: "Analysts compare valuation, earnings strength, and investor upside across both equities.",
    rawTopic: "sports",
    rawTags: ["sports", "baseball"],
    fallbackTopic: "sports",
  })

  assert.equal(classification.topic, "markets")
  assert.equal(classification.tags.includes("sports"), false)
  assert.equal(matchesRequestedNewsTopics(["sports"], classification), false)
  assert.equal(matchesRequestedNewsTopics(["markets"], classification), true)
})

test("genuine sports article still matches sports selections", () => {
  const classification = resolveNewsArticleClassification({
    title: "Yankees baseball team wins playoff opener behind dominant pitching",
    summary: "New York opened the postseason with a strong game from its starting pitcher and late insurance runs.",
    rawTopic: "sports",
    rawTags: ["sports", "baseball"],
    fallbackTopic: "sports",
  })

  assert.equal(classification.topic, "sports")
  assert.equal(classification.tags.includes("sports"), true)
  assert.equal(matchesRequestedNewsTopics(["sports"], classification), true)
})

test("business selections accept markets-classified earnings coverage", () => {
  const classification = resolveNewsArticleClassification({
    title: "Bel Fuse shares rise after earnings beat and revenue guidance update",
    summary: "The company posted quarterly revenue growth and analysts raised price targets.",
    rawTopic: "business",
    rawTags: ["business"],
    fallbackTopic: "business",
  })

  assert.equal(matchesRequestedNewsTopics(["business"], classification), true)
  assert.equal(matchesRequestedNewsTopics(["markets"], classification), true)
})
