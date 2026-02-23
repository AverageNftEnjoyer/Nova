import fs from "node:fs";
import path from "node:path";

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function requireMatch(content, pattern, label, failures) {
  if (!pattern.test(content)) failures.push(label);
}

function main() {
  const repoRoot = process.cwd();
  const dispatchPath = path.join(repoRoot, "hud", "lib", "missions", "output", "dispatch.ts");
  const pendingStorePath = path.join(repoRoot, "hud", "lib", "novachat", "pending-messages.ts");
  const convoHookPath = path.join(repoRoot, "hud", "lib", "chat", "hooks", "useConversations.ts");

  const dispatch = readFile(dispatchPath);
  const pending = readFile(pendingStorePath);
  const conversations = readFile(convoHookPath);
  const failures = [];

  requireMatch(dispatch, /deliveryKey/, "dispatch.ts missing novachat deliveryKey metadata", failures);
  requireMatch(dispatch, /missionRunId[\s\S]*runKey[\s\S]*nodeId[\s\S]*outputIndex/, "dispatch.ts missing run-scoped key composition", failures);

  requireMatch(pending, /normalizeDeliveryKey/, "pending-messages.ts missing deliveryKey normalization", failures);
  requireMatch(pending, /existing\s*=\s*messages\.find\([\s\S]*deliveryKey/, "pending-messages.ts missing deliveryKey dedupe lookup", failures);

  requireMatch(conversations, /pendingMissionConversationByGroupRef/, "useConversations.ts missing group conversation map", failures);
  requireMatch(conversations, /resolvePendingMissionGroupKey/, "useConversations.ts missing pending group key resolver", failures);
  requireMatch(conversations, /seenDeliveryKeys/, "useConversations.ts missing per-poll delivery dedupe", failures);

  if (failures.length > 0) {
    console.error("FAIL hud novachat mission output idempotency smoke");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("PASS hud novachat mission output idempotency smoke");
}

main();
