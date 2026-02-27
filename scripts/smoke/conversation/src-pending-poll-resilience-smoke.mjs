import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

const results = [];

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

async function run(name, fn) {
  try {
    await fn();
    record("PASS", name);
  } catch (error) {
    record("FAIL", name, error instanceof Error ? error.message : String(error));
  }
}

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

function assertIncludesAll(source, tokens, prefix = "missing token") {
  for (const token of tokens) {
    assert.equal(source.includes(token), true, `${prefix}: ${token}`);
  }
}

const [
  useConversationsSource,
  pendingPollSource,
  proxySource,
  pendingRouteSource,
] = await Promise.all([
  readFile(path.join(process.cwd(), "hud/lib/chat/hooks/useConversations.ts"), "utf8"),
  readFile(path.join(process.cwd(), "hud/lib/chat/hooks/use-conversations/pending-poll.ts"), "utf8"),
  readFile(path.join(process.cwd(), "hud/proxy.ts"), "utf8"),
  readFile(path.join(process.cwd(), "hud/app/api/telegram/pending/route.ts"), "utf8"),
]);

const pendingPollCombinedSource = `${useConversationsSource}\n${pendingPollSource}`;

await run("P1 pending poll uses user-scoped lease and cooldown guard", async () => {
  const requiredTokens = [
    "const PENDING_POLL_USER_SCOPE = \"__user__\"",
    "const PENDING_POLL_MIN_INTERVAL_MS = 1_200",
    "const PENDING_POLL_COOLDOWN_STORAGE_KEY = \"nova_pending_poll_cooldown_v1\"",
    "const pendingPollLastStartedAtRef = useRef(0)",
    "if (pendingPollRetryUntilRef.current > nowMs) return 0",
    "pendingPollLastStartedAtRef.current > 0",
    "nowMs - pendingPollLastStartedAtRef.current < PENDING_POLL_MIN_INTERVAL_MS",
    "const sharedRetryAtMs = readSharedPendingPollCooldown(pollScopeKey)",
    "if (sharedRetryAtMs > Date.now()) {",
    "pendingPollRetryUntilRef.current = Math.max(pendingPollRetryUntilRef.current, sharedRetryAtMs)",
    "buildPendingPollScopeKey(",
    "PENDING_POLL_USER_SCOPE",
  ];
  assertIncludesAll(pendingPollCombinedSource, requiredTokens);
});

await run("P2 pending poll writes/clears shared cooldown around retries and recovery", async () => {
  const requiredTokens = [
    "writeSharedPendingPollCooldown(pollScopeKey, retryAtMs)",
    "clearSharedPendingPollCooldown(pollScopeKey)",
    "message: \"Pending queue rate-limited. Retrying shortly.\"",
    "message: \"Pending queue temporarily unavailable. Retrying.\"",
    "message: \"Pending queue error. Retrying.\"",
  ];
  assertIncludesAll(pendingPollCombinedSource, requiredTokens);
});

await run("P3 proxy bypasses global IP throttling for telegram pending endpoint", async () => {
  const requiredTokens = [
    "function shouldBypassIpRateLimit(req: NextRequest): boolean {",
    "pathname === \"/api/telegram/pending\" || pathname.startsWith(\"/api/telegram/pending/\")",
    "if (shouldBypassIpRateLimit(req)) {",
    "return NextResponse.next()",
  ];
  assertIncludesAll(proxySource, requiredTokens);
});

await run("P4 pending endpoint returns soft-throttle payload and client honors it", async () => {
  const routeTokens = [
    "rateLimited: true",
    "retryAfterMs",
    "status: 200",
    "createRateLimitHeaders(limit)",
  ];
  assertIncludesAll(pendingRouteSource, routeTokens, "missing route token");
  const clientTokens = [
    "if (data.rateLimited) {",
    "parseRetryAfterMs(res.headers.get(\"Retry-After\"), Number(data?.retryAfterMs || 0))",
    "message: \"Pending queue rate-limited. Retrying shortly.\"",
  ];
  assertIncludesAll(pendingPollCombinedSource, clientTokens, "missing client token");
});

await run("P5 pending mission group binds to one conversation per poll cycle", async () => {
  const requiredTokens = [
    "runConversationByGroup.set(groupKey, targetConvoId)",
    "updatedConvos = [targetConvo, ...updatedConvos.filter((c) => c.id !== targetConvoId)]",
  ];
  assertIncludesAll(pendingPollCombinedSource, requiredTokens, "missing dedupe token");
});

await run("P6 pending API leases delivery briefly and returns no-store responses", async () => {
  const routeTokens = [
    "const PENDING_DELIVERY_LEASE_MS = readIntEnv(\"NOVA_PENDING_DELIVERY_LEASE_MS\", 12_000, 1_000, 60_000)",
    "function leaseDeliverableMessages(userId: string, messages: PendingTelegramMessage[]): PendingTelegramMessage[] {",
    "pendingDeliveryLeaseByKey.set(key, nowMs + PENDING_DELIVERY_LEASE_MS)",
    "function releaseDeliveryLeases(userId: string, messageIds: string[]): void {",
    "releaseDeliveryLeases(verified.user.id, messageIds)",
    "headers.set(\"Cache-Control\", \"no-store\")",
    "{ headers: { \"Cache-Control\": \"no-store\" } }",
  ];
  assertIncludesAll(pendingRouteSource, routeTokens, "missing route lease token");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
