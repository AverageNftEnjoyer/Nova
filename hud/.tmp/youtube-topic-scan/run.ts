import { getYouTubeFeed } from "../../lib/integrations/youtube/service/index";

type Scope = { user: { id: string }; allowServiceRole: true; serviceRoleReason: "youtube-oauth-callback" };
type Row = {
  topic: string;
  ok: boolean;
  itemCount: number;
  topVideoId: string;
  topTitle: string;
  topReason: string;
  relevance: number;
  error: string;
};

const userContextId = String(process.env.NOVA_YOUTUBE_SCAN_USER || "").trim();
if (!userContextId) {
  console.error("Missing NOVA_YOUTUBE_SCAN_USER env var.");
  process.exit(1);
}

const scope: Scope = { user: { id: userContextId }, allowServiceRole: true, serviceRoleReason: "youtube-oauth-callback" };

const topics = [
  "ai chip updates",
  "nvidia gpu roadmap",
  "amd ai accelerators",
  "intel foundry updates",
  "tsmc 2nm process",
  "openai releases",
  "anthropic claude updates",
  "google gemini updates",
  "microsoft copilot updates",
  "meta llama updates",
  "semiconductor supply chain",
  "us china chip policy",
  "data center cooling ai",
  "ai model benchmarking",
  "robotics ai breakthroughs",
  "autonomous driving ai",
  "edge ai devices",
  "cloud ai pricing",
  "cybersecurity ai news",
  "quantum computing updates",
  "bitcoin etf news",
  "ethereum scaling updates",
  "solana ecosystem updates",
  "tesla fsd updates",
  "spacex starship updates",
  "nasa artemis mission",
  "global macro market news",
  "fed interest rate outlook",
  "geopolitics tech news",
  "startup funding ai",
];

const STOP = new Set([
  "a", "an", "and", "about", "for", "from", "in", "on", "of", "to", "the",
  "news", "latest", "update", "updates", "video", "videos", "youtube", "today", "live", "watch", "new",
]);

function topicTokens(topic: string): string[] {
  return Array.from(new Set(String(topic || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP.has(token))));
}

function relevance(topic: string, payload: { title?: string; description?: string; channelTitle?: string } | null): number {
  const tokens = topicTokens(topic);
  if (tokens.length === 0) return 1;
  const hay = `${payload?.title || ""} ${payload?.description || ""} ${payload?.channelTitle || ""}`.toLowerCase();
  if (!hay) return 0;
  let matches = 0;
  for (const token of tokens) {
    if (hay.includes(token)) matches += 1;
  }
  return matches / tokens.length;
}

async function run(): Promise<void> {
  const rows: Row[] = [];

  for (const topic of topics) {
    try {
      const result = await getYouTubeFeed(
        {
          mode: "personalized",
          topic,
          maxResults: 8,
          preferredSources: [],
          historyChannelIds: [],
        },
        scope,
      );

      const top = result.items?.[0] || null;
      const rel = relevance(topic, top);
      const relPass = rel >= 0.34;
      rows.push({
        topic,
        ok: Boolean(top) && relPass,
        itemCount: Array.isArray(result.items) ? result.items.length : 0,
        topVideoId: String(top?.videoId || ""),
        topTitle: String(top?.title || ""),
        topReason: String(top?.reason || ""),
        relevance: Number(rel.toFixed(2)),
        error: "",
      });
    } catch (error) {
      rows.push({
        topic,
        ok: false,
        itemCount: 0,
        topVideoId: "",
        topTitle: "",
        topReason: "",
        relevance: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const total = rows.length;
  const pass = rows.filter((row) => row.ok).length;
  const withTop = rows.filter((row) => row.topVideoId).length;
  const uniqueTop = new Set(rows.map((row) => row.topVideoId).filter(Boolean)).size;
  const duplicateTop = withTop - uniqueTop;

  console.log(`TOPIC_SCAN_SUMMARY total=${total} pass=${pass} withTop=${withTop} uniqueTop=${uniqueTop} duplicateTop=${duplicateTop}`);
  for (const row of rows) {
    if (row.error) {
      console.log(`[FAIL] topic="${row.topic}" error="${row.error.replace(/\"/g, "'")}"`);
      continue;
    }
    console.log(
      `[${row.ok ? "PASS" : "FAIL"}] topic="${row.topic}" count=${row.itemCount} relevance=${row.relevance} reason="${row.topReason}" videoId="${row.topVideoId}" title="${row.topTitle.replace(/\"/g, "'").slice(0, 160)}"`,
    );
  }

  if (pass < total) process.exitCode = 2;
}

void run();
