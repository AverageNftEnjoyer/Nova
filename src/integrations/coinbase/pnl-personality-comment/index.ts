export type CoinbasePersonaTone = "neutral" | "enthusiastic" | "calm" | "direct" | "relaxed";

export interface CoinbasePnlPersonalityCommentInput {
  assistantName?: string;
  tone?: string;
  cadence?: "daily" | "weekly" | "report";
  estimatedTotalUsd?: number;
  recentNetNotionalUsd?: number;
  thresholdPct?: number;
  seedKey?: string;
  transactionCount?: number;
  valuedAssetCount?: number;
  freshnessMs?: number;
  minAbsoluteNotionalUsd?: number;
  minTransactionCount?: number;
  maxFreshnessMs?: number;
}

function normalizeTone(value: unknown): CoinbasePersonaTone {
  const tone = String(value || "").trim().toLowerCase();
  if (tone === "enthusiastic" || tone === "calm" || tone === "direct" || tone === "relaxed") return tone;
  return "neutral";
}

function hashSeed(value: unknown): number {
  const input = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function pickVariant(lines: string[], seed: number): string {
  if (!Array.isArray(lines) || lines.length === 0) return "";
  return String(lines[seed % lines.length] || "");
}

export function buildCoinbasePnlPersonalityComment(input: CoinbasePnlPersonalityCommentInput): string {
  const assistantName = String(input.assistantName || "Nova").trim() || "Nova";
  const tone = normalizeTone(input.tone);
  const cadence = input.cadence === "daily" || input.cadence === "weekly" ? input.cadence : "report";
  const threshold = Number.isFinite(Number(input.thresholdPct)) ? Math.max(1, Number(input.thresholdPct)) : 10;
  const minAbsoluteNotionalUsd = Number.isFinite(Number(input.minAbsoluteNotionalUsd))
    ? Math.max(0, Number(input.minAbsoluteNotionalUsd))
    : 250;
  const minTransactionCount = Number.isFinite(Number(input.minTransactionCount))
    ? Math.max(0, Math.floor(Number(input.minTransactionCount)))
    : 3;
  const maxFreshnessMs = Number.isFinite(Number(input.maxFreshnessMs))
    ? Math.max(1_000, Number(input.maxFreshnessMs))
    : 6 * 60 * 60 * 1000;
  const estimatedTotalUsd = Number(input.estimatedTotalUsd);
  const recentNetNotionalUsd = Number(input.recentNetNotionalUsd);
  const transactionCount = Number(input.transactionCount);
  const valuedAssetCount = Number(input.valuedAssetCount);
  const freshnessMs = Number(input.freshnessMs);
  if (!Number.isFinite(estimatedTotalUsd) || estimatedTotalUsd <= 0 || !Number.isFinite(recentNetNotionalUsd)) return "";
  if (Math.abs(recentNetNotionalUsd) < minAbsoluteNotionalUsd) return "";
  if (Number.isFinite(transactionCount) && transactionCount < minTransactionCount) return "";
  if (Number.isFinite(valuedAssetCount) && valuedAssetCount <= 0) return "";
  if (Number.isFinite(freshnessMs) && freshnessMs > maxFreshnessMs) return "";
  const pct = (recentNetNotionalUsd / estimatedTotalUsd) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) < threshold + 0.05) return "";
  const direction: "up" | "down" = pct >= 0 ? "up" : "down";
  const pctText = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const seed = hashSeed(`${String(input.seedKey || "")}:${tone}:${cadence}:${direction}:${Math.round(pct * 10)}`);

  const variants: Record<CoinbasePersonaTone, Record<"up" | "down", string[]>> = {
    enthusiastic: {
      up: [
        `${assistantName} note (${cadence}): ${pctText} and your portfolio chose fireworks today.`,
        `${assistantName} note (${cadence}): ${pctText} up. Your bags are doing celebratory laps.`,
        `${assistantName} note (${cadence}): ${pctText} green. Portfolio swagger is currently unlocked.`,
        `${assistantName} note (${cadence}): ${pctText}. This is premium chart energy.`,
      ],
      down: [
        `${assistantName} note (${cadence}): ${pctText}. Your portfolio hit the gym and skipped leg day.`,
        `${assistantName} note (${cadence}): ${pctText} down. Red candles are loud; discipline should be louder.`,
        `${assistantName} note (${cadence}): ${pctText}. Not pretty, but this is where process earns its paycheck.`,
        `${assistantName} note (${cadence}): ${pctText}. Temporary pain, permanent risk rules.`,
      ],
    },
    calm: {
      up: [
        `${assistantName} note (${cadence}): ${pctText} is a meaningful gain. Quietly strong.`,
        `${assistantName} note (${cadence}): ${pctText} up. Stable execution is paying off.`,
        `${assistantName} note (${cadence}): ${pctText}. Nice progress without overreaching.`,
        `${assistantName} note (${cadence}): ${pctText}. Keep consistency ahead of excitement.`,
      ],
      down: [
        `${assistantName} note (${cadence}): ${pctText} indicates notable pressure. Stay systematic.`,
        `${assistantName} note (${cadence}): ${pctText} down. Good time to tighten risk controls.`,
        `${assistantName} note (${cadence}): ${pctText}. Reset, review, continue deliberately.`,
        `${assistantName} note (${cadence}): ${pctText}. Calm decisions outperform emotional ones.`,
      ],
    },
    direct: {
      up: [
        `${assistantName} note (${cadence}): ${pctText}. Strong move. Do not overtrade it.`,
        `${assistantName} note (${cadence}): ${pctText}. Positive acceleration confirmed.`,
        `${assistantName} note (${cadence}): ${pctText}. Good result. Protect the gain.`,
        `${assistantName} note (${cadence}): ${pctText}. Keep what works, cut what does not.`,
      ],
      down: [
        `${assistantName} note (${cadence}): ${pctText}. Material drawdown. Reduce chaos.`,
        `${assistantName} note (${cadence}): ${pctText}. Tighten exposure now.`,
        `${assistantName} note (${cadence}): ${pctText}. Capital preservation first.`,
        `${assistantName} note (${cadence}): ${pctText}. Red week/day. Recheck sizing and entries.`,
      ],
    },
    relaxed: {
      up: [
        `${assistantName} note (${cadence}): ${pctText} up. Your portfolio woke up in a good mood.`,
        `${assistantName} note (${cadence}): ${pctText} green. Nice tailwind on the positions.`,
        `${assistantName} note (${cadence}): ${pctText}. That is a clean lift.`,
        `${assistantName} note (${cadence}): ${pctText}. Good vibes, keep it measured.`,
      ],
      down: [
        `${assistantName} note (${cadence}): ${pctText}. Market threw a tantrum; we stay composed.`,
        `${assistantName} note (${cadence}): ${pctText} down. Breathe, trim noise, keep structure.`,
        `${assistantName} note (${cadence}): ${pctText}. Rough patch, not a final verdict.`,
        `${assistantName} note (${cadence}): ${pctText}. Slow and disciplined beats rushed and sorry.`,
      ],
    },
    neutral: {
      up: [
        `${assistantName} note (${cadence}): ${pctText} indicates strong positive movement.`,
        `${assistantName} note (${cadence}): ${pctText} gain recorded for this period.`,
        `${assistantName} note (${cadence}): ${pctText} up move is significant.`,
        `${assistantName} note (${cadence}): ${pctText}. Portfolio performance is notably positive.`,
      ],
      down: [
        `${assistantName} note (${cadence}): ${pctText} indicates meaningful negative movement.`,
        `${assistantName} note (${cadence}): ${pctText} drawdown recorded for this period.`,
        `${assistantName} note (${cadence}): ${pctText} down move is significant.`,
        `${assistantName} note (${cadence}): ${pctText}. Portfolio performance is notably negative.`,
      ],
    },
  };

  return pickVariant(variants[tone][direction], seed);
}
