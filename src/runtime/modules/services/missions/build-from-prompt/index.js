import {
  deriveScheduleFromPrompt,
  inferRequestedOutputChannel,
  normalizeOutputChannelId,
} from "../generation-helpers/index.js";
import {
  parseLlmConnections,
  parseLlmNodes,
} from "../llm-graph-parser/index.js";
import { resolveTimezone } from "../../shared/timezone/index.js";

function requireFunction(dependencies, key) {
  const candidate = dependencies?.[key];
  if (typeof candidate !== "function") {
    throw new Error(`Mission build-from-prompt dependency "${key}" is required.`);
  }
  return candidate;
}

function shouldBuildAgentGraph(prompt) {
  const normalized = String(prompt || "").toLowerCase();
  return (
    normalized.includes("agent")
    || normalized.includes("agents")
    || normalized.includes("council")
    || normalized.includes("domain manager")
    || normalized.includes("provider selector")
    || normalized.includes("command spine")
    || normalized.includes("audit")
    || normalized.includes("team of")
  );
}

export async function runBuildMissionFromPrompt(prompt, options = {}, dependencies = {}) {
  const loadIntegrationsConfig = requireFunction(dependencies, "loadIntegrationsConfig");
  const loadIntegrationCatalog = requireFunction(dependencies, "loadIntegrationCatalog");
  const parseJsonObject = requireFunction(dependencies, "parseJsonObject");
  const completeWithConfiguredLlm = requireFunction(dependencies, "completeWithConfiguredLlm");
  const isMissionAgentGraphEnabled = requireFunction(dependencies, "isMissionAgentGraphEnabled");
  const missionUsesAgentGraph = requireFunction(dependencies, "missionUsesAgentGraph");
  const validateMissionGraphForVersioning = requireFunction(dependencies, "validateMissionGraphForVersioning");
  const buildMission = requireFunction(dependencies, "buildMission");
  const warn = requireFunction(dependencies, "warn");

  const scope = options?.scope;
  const scopeRecord = scope;
  const scopeUser = scopeRecord?.user;
  const userId = String(
    options?.userId
    || scopeRecord?.userId
    || scopeUser?.id
    || "",
  );

  let config = null;
  let catalog = [];
  try {
    [config, catalog] = await Promise.all([loadIntegrationsConfig(scope), loadIntegrationCatalog(scope)]);
  } catch (error) {
    warn(
      "[buildMissionFromPrompt] Failed to load integrations config/catalog, using defaults:",
      error instanceof Error ? error.message : "unknown",
    );
  }

  const llmOptions = catalog.filter((item) => item.kind === "llm" && item.connected).map((item) => item.id).filter(Boolean);
  const outputOptions = catalog
    .filter((item) => item.kind === "channel" && item.connected)
    .map((item) => normalizeOutputChannelId(item.id))
    .filter(Boolean);
  const outputSet = new Set(outputOptions);
  if (outputSet.size === 0) {
    throw new Error("Mission generation requires at least one connected output integration.");
  }
  const defaultOutput = outputOptions[0];

  const activeLlmProvider = String(config?.activeLlmProvider || "");
  if (llmOptions.length === 0) {
    throw new Error("Mission generation requires at least one connected LLM provider.");
  }
  const rawDefaultLlm = llmOptions.includes(activeLlmProvider) ? activeLlmProvider : llmOptions[0];
  const defaultLlm = rawDefaultLlm === "claude" || rawDefaultLlm === "grok" || rawDefaultLlm === "gemini" ? rawDefaultLlm : "openai";

  const requestedOutput = inferRequestedOutputChannel(prompt, outputSet, defaultOutput);
  const requireAgentGraph = shouldBuildAgentGraph(prompt);
  if (requireAgentGraph && !isMissionAgentGraphEnabled()) {
    throw new Error("Mission generation requested an agent graph, but NOVA_MISSIONS_AGENT_GRAPH_ENABLED is disabled.");
  }
  const scheduleHint = deriveScheduleFromPrompt(prompt);
  const scheduleTime = scheduleHint.time || "09:00";
  const scheduleTz = resolveTimezone(scheduleHint.timezone);

  const outputNodeType = (() => {
    const map = { telegram: "telegram-output", discord: "discord-output", email: "email-output", slack: "slack-output" };
    return map[requestedOutput] || "telegram-output";
  })();

  const systemText = [
    "You are Nova's mission architect. Output only strict JSON - no markdown, no explanation.",
    "Build production-grade automation workflows using native MissionNode types.",
    "For agent missions, enforce this command spine: operator -> council -> domain-manager -> worker -> audit -> operator.",
    "Use provider-selector as a separate execution rail and never as a manager role.",
    "Agent supervisor, worker, and audit nodes should include inputMapping, outputSchema, timeoutMs, and retryPolicy when possible.",
    "Never emit unknown node types. Never omit required connections.",
    requireAgentGraph
      ? "This prompt requires an agent graph. You must emit supervisor, council, domain-manager, worker, provider-selector, audit, and handoff nodes."
      : "Use a non-agent graph unless the user explicitly asks for multi-agent orchestration.",
    "Pass data between nodes using template expressions: {{$nodes.NODE_ID.output.text}} or {{$nodes.NODE_ID.output.items}}.",
    "All node IDs must be unique strings (n1, n2, ...). Connections: sourceNodeId:sourcePort -> targetNodeId:targetPort.",
    `Use 24-hour HH:MM time. Default timezone: ${scheduleTz}.`,
    `Connected AI models: ${llmOptions.join(", ") || "openai"}. Preferred AI: ${defaultLlm}.`,
    `Connected output channels: ${[...outputSet].join(", ")}. Preferred output: ${requestedOutput} -> use node type "${outputNodeType}".`,
    "For web/news tasks always include a web-search node before AI. Do not invent facts.",
    "For crypto/Coinbase tasks use a coinbase node (intent: report|portfolio|price|transactions|status).",
  ].join(" ");

  const schemaExample = JSON.stringify({
    label: "Mission title (max 30 chars)",
    description: "What this mission does",
    schedule: { mode: "daily", time: scheduleTime, timezone: scheduleTz, days: ["mon", "tue", "wed", "thu", "fri"] },
    nodes: requireAgentGraph
      ? [
          { id: "n1", type: "schedule-trigger", label: "Daily trigger", triggerMode: "daily", triggerTime: scheduleTime, triggerTimezone: scheduleTz },
          { id: "n2", type: "agent-supervisor", label: "Operator", agentId: "operator", role: "operator", goal: "Command councils and manager routing.", inputMapping: { brief: "{{$nodes.n1.output.text}}" }, outputSchema: "{\"route\":\"string\"}", timeoutMs: 120000, retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
          { id: "n3", type: "agent-worker", label: "Routing Council", agentId: "routing-council", role: "routing-council", goal: "Classify intent and select domain manager.", inputMapping: { route: "{{$nodes.n2.output.text}}" }, outputSchema: "{\"manager\":\"string\"}", timeoutMs: 120000, retryPolicy: { maxAttempts: 2, backoffMs: 1500 } },
          { id: "n4", type: "agent-worker", label: "System Manager", agentId: "system-manager", role: "system-manager", goal: "Assign work to worker agent.", inputMapping: { manager: "{{$nodes.n3.output.text}}" }, outputSchema: "{\"worker\":\"string\"}", timeoutMs: 120000, retryPolicy: { maxAttempts: 2, backoffMs: 1500 } },
          { id: "n5", type: "agent-worker", label: "Worker Agent", agentId: "worker-1", role: "worker-agent", goal: "Execute the task.", inputMapping: { assignment: "{{$nodes.n4.output.text}}" }, outputSchema: "{\"result\":\"string\"}", timeoutMs: 180000, retryPolicy: { maxAttempts: 2, backoffMs: 2000 } },
          { id: "n6", type: "provider-selector", label: "Provider Rail", allowedProviders: [defaultLlm], defaultProvider: defaultLlm, strategy: "policy" },
          { id: "n7", type: "agent-audit", label: "Audit", agentId: "audit-council", role: "audit-council", goal: "Verify isolation and policy checks.", requiredChecks: ["user-context-isolation", "policy-guardrails"], inputMapping: { review: "{{$nodes.n5.output.text}}" }, outputSchema: "{\"audit\":\"string\"}", timeoutMs: 120000, retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
          { id: "n8", type: "agent-handoff", label: "Operator->Council", fromAgentId: "operator", toAgentId: "routing-council", reason: "route intent" },
          { id: "n9", type: "agent-handoff", label: "Council->Manager", fromAgentId: "routing-council", toAgentId: "system-manager", reason: "domain ownership" },
          { id: "n10", type: "agent-handoff", label: "Manager->Worker", fromAgentId: "system-manager", toAgentId: "worker-1", reason: "execution delegation" },
          { id: "n11", type: "agent-handoff", label: "Worker->Audit", fromAgentId: "worker-1", toAgentId: "audit-council", reason: "compliance review" },
          { id: "n12", type: "agent-handoff", label: "Audit->Operator", fromAgentId: "audit-council", toAgentId: "operator", reason: "final approval" },
          { id: "n13", type: outputNodeType, label: "Send output", messageTemplate: "{{$nodes.n2.output.text}}" },
        ]
      : [
          { id: "n1", type: "schedule-trigger", label: "Daily trigger", triggerMode: "daily", triggerTime: scheduleTime, triggerTimezone: scheduleTz },
          { id: "n2", type: "web-search", label: "Search news", query: "SEARCH QUERY HERE" },
          { id: "n3", type: "ai-summarize", label: "Summarize", prompt: "Summarize in clear bullet points. Do not invent facts.", integration: defaultLlm, detailLevel: "standard" },
          { id: "n4", type: outputNodeType, label: "Send output", messageTemplate: "{{$nodes.n3.output.text}}" },
        ],
    connections: requireAgentGraph
      ? [
          { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "n2", targetPort: "main" },
          { id: "c2", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "n3", targetPort: "main" },
          { id: "c3", sourceNodeId: "n3", sourcePort: "main", targetNodeId: "n4", targetPort: "main" },
          { id: "c4", sourceNodeId: "n4", sourcePort: "main", targetNodeId: "n5", targetPort: "main" },
          { id: "c5", sourceNodeId: "n5", sourcePort: "main", targetNodeId: "n6", targetPort: "main" },
          { id: "c6", sourceNodeId: "n6", sourcePort: "main", targetNodeId: "n7", targetPort: "main" },
          { id: "c7", sourceNodeId: "n7", sourcePort: "main", targetNodeId: "n8", targetPort: "main" },
          { id: "c8", sourceNodeId: "n8", sourcePort: "main", targetNodeId: "n9", targetPort: "main" },
          { id: "c9", sourceNodeId: "n9", sourcePort: "main", targetNodeId: "n10", targetPort: "main" },
          { id: "c10", sourceNodeId: "n10", sourcePort: "main", targetNodeId: "n11", targetPort: "main" },
          { id: "c11", sourceNodeId: "n11", sourcePort: "main", targetNodeId: "n12", targetPort: "main" },
          { id: "c12", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "n13", targetPort: "main" },
        ]
      : [
          { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "n2", targetPort: "main" },
          { id: "c2", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "n3", targetPort: "main" },
          { id: "c3", sourceNodeId: "n3", sourcePort: "main", targetNodeId: "n4", targetPort: "main" },
        ],
  });

  const userText = [
    `User prompt: ${prompt}`,
    "Additional node types you can use:",
    "- coinbase: intent=report|portfolio|price|transactions|status, assets=[\"BTC\",\"ETH\"]",
    "- rss-feed: url=FEED_URL, maxItems=10",
    "- http-request: url=API_URL, method=GET|POST",
    "- condition: rules=[{field,operator,value}], logic=all|any  (ports: true, false)",
    "- ai-generate: prompt=WRITE_PROMPT, integration, detailLevel",
    "- ai-classify: prompt=CLASSIFY_PROMPT, categories=[\"cat1\",\"cat2\"]",
    "- format: template=HANDLEBARS_TEMPLATE, outputFormat=text|markdown|html",
    "- set-variables: assignments=[{name,value}]",
    "- email-output: subject=SUBJECT, messageTemplate",
    "- slack-output: channel=#CHANNEL, messageTemplate",
    requireAgentGraph
      ? "- For this prompt, include the complete command-spine handoff set and a dedicated agent-audit node."
      : "- Use agent nodes only when the user asks for multi-agent routing.",
    "Return JSON matching this exact structure:",
    schemaExample,
  ].join("\n");

  let provider = defaultLlm;
  let model = "";
  let nodes = [];
  let connections = [];
  let rejectedNodes = [];
  let label = "";
  let description = "";

  try {
    const completion = await completeWithConfiguredLlm(systemText, userText, 2000, scope);
    const rawProvider = String(completion.provider || defaultLlm);
    provider = rawProvider === "claude" || rawProvider === "openai" || rawProvider === "grok" || rawProvider === "gemini"
      ? rawProvider
      : defaultLlm;
    model = String(completion.model || "");
    const parsed = parseJsonObject(completion.text);
    if (parsed) {
      label = String(parsed.label || "").trim().slice(0, 40);
      description = String(parsed.description || "").trim();
      const parsedNodes = parseLlmNodes(Array.isArray(parsed.nodes) ? parsed.nodes : []);
      nodes = parsedNodes.nodes;
      rejectedNodes = parsedNodes.rejected;
      const nodeIds = new Set(nodes.map((node) => node.id));
      connections = parseLlmConnections(Array.isArray(parsed.connections) ? parsed.connections : [], nodeIds);
    }
  } catch (error) {
    throw new Error(`Mission generation failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  const triggerTypes = new Set(["schedule-trigger", "manual-trigger", "webhook-trigger", "event-trigger"]);
  const hasTrigger = nodes.some((node) => triggerTypes.has(node.type));

  if (nodes.length === 0) {
    throw new Error("Mission generation returned zero nodes.");
  }
  if (rejectedNodes.length > 0) {
    const sample = rejectedNodes.slice(0, 3).map((item) => `${item.type}@${item.index}`).join(", ");
    throw new Error(`Mission generation returned invalid node payload(s): ${sample}.`);
  }
  if (!hasTrigger) {
    throw new Error("Mission generation must include at least one trigger node.");
  }
  if (!isMissionAgentGraphEnabled() && missionUsesAgentGraph({ nodes })) {
    throw new Error("Mission generation returned an agent graph while NOVA_MISSIONS_AGENT_GRAPH_ENABLED is disabled.");
  }
  if (requireAgentGraph && !nodes.some((node) => node.type.startsWith("agent-") || node.type === "provider-selector")) {
    throw new Error("Mission generation required an agent graph but returned no agent orchestration nodes.");
  }
  if (connections.length === 0 && nodes.length > 1) {
    throw new Error("Mission generation returned a disconnected graph (missing connections).");
  }

  const mission = buildMission({
    userId,
    label: label || prompt.slice(0, 30) || "New Mission",
    description: description || prompt,
    nodes,
    connections,
    integration: requestedOutput,
    chatIds: options?.chatIds || [],
  });

  const issues = validateMissionGraphForVersioning(mission);
  if (issues.length > 0) {
    const sample = issues.slice(0, 3).map((issue) => issue.code).join(", ");
    throw new Error(`Mission generation produced invalid graph contract: ${sample}.`);
  }

  return { mission: { ...mission, status: "draft" }, provider, model };
}
