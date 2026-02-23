import type { CoinbasePortfolioSnapshot, CoinbaseTransactionEvent } from "./types.js";

export type CoinbaseReportMode = "concise" | "detailed";

export interface CoinbaseRenderInput {
  mode: CoinbaseReportMode;
  source: string;
  generatedAtMs: number;
  portfolio: CoinbasePortfolioSnapshot;
  transactions: CoinbaseTransactionEvent[];
  preferences?: {
    decimalPlaces?: number;
    includeTimestamp?: boolean;
    includeFreshness?: boolean;
    dateFormat?: "MM/DD/YYYY" | "ISO_DATE";
  };
  personalityComment?: string;
}

function clampDecimalPlaces(value: unknown, fallback = 2): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(8, parsed));
}

function formatUsd(value: number | null | undefined, decimalPlaces = 2): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "n/a";
  const places = clampDecimalPlaces(decimalPlaces, 2);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(amount);
}

function formatNumber(value: number | null | undefined, decimalPlaces = 2): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "n/a";
  const places = clampDecimalPlaces(decimalPlaces, 2);
  return amount.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
}

function formatDate(valueMs: number, dateFormat: "MM/DD/YYYY" | "ISO_DATE" = "MM/DD/YYYY"): string {
  const ts = Number(valueMs);
  if (!Number.isFinite(ts) || ts <= 0) return "unknown";
  if (dateFormat === "ISO_DATE") return new Date(ts).toISOString().slice(0, 10);
  const d = new Date(ts);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

function formatTimestampIso(valueMs: number): string {
  const ts = Number(valueMs);
  if (!Number.isFinite(ts) || ts <= 0) return "unknown";
  return new Date(ts).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildMetadataLines(input: CoinbaseRenderInput): string[] {
  const includeTimestamp = input.preferences?.includeTimestamp === true;
  const includeFreshness = input.preferences?.includeFreshness === true;
  const dateFormat = input.preferences?.dateFormat === "ISO_DATE" ? "ISO_DATE" : "MM/DD/YYYY";
  const lines = [
    `date: ${formatDate(input.generatedAtMs, dateFormat)}`,
    `source: ${String(input.source || input.portfolio.source || "coinbase")}`,
  ];
  if (includeTimestamp) lines.push(`timestamp: ${formatTimestampIso(input.generatedAtMs)}`);
  if (includeFreshness) lines.push(`freshness: ${Math.round(Math.max(0, Number(input.portfolio.freshnessMs || 0)) / 1000)}s`);
  return lines;
}

function buildConciseBody(input: CoinbaseRenderInput): string[] {
  const decimalPlaces = clampDecimalPlaces(input.preferences?.decimalPlaces, 2);
  const nonZero = input.portfolio.balances.filter((entry) => Number(entry.total || 0) > 0);
  const top = nonZero
    .slice(0, 4)
    .map((entry) => `${String(entry.assetSymbol || "").toUpperCase()}: ${formatNumber(entry.total, decimalPlaces)}`);
  return [
    `active_assets: ${nonZero.length}`,
    `recent_transactions: ${input.transactions.length}`,
    top.length > 0 ? `top_holdings: ${top.join(" | ")}` : "top_holdings: none",
  ];
}

function buildDetailedBody(input: CoinbaseRenderInput): string[] {
  const decimalPlaces = clampDecimalPlaces(input.preferences?.decimalPlaces, 2);
  const dateFormat = input.preferences?.dateFormat === "ISO_DATE" ? "ISO_DATE" : "MM/DD/YYYY";
  const nonZero = input.portfolio.balances.filter((entry) => Number(entry.total || 0) > 0);
  const holdings = nonZero.slice(0, 12).map(
    (entry) =>
      `- ${entry.assetSymbol}: total=${formatNumber(entry.total, decimalPlaces)} available=${formatNumber(entry.available, decimalPlaces)} hold=${formatNumber(entry.hold, decimalPlaces)}`,
  );
  const txLines = input.transactions.slice(0, 12).map(
    (event) =>
      `- ${event.side.toUpperCase()} ${formatNumber(event.quantity, decimalPlaces)} ${event.assetSymbol} @ ${formatUsd(event.price, decimalPlaces)} fee=${formatUsd(event.fee, decimalPlaces)} at=${formatDate(event.occurredAtMs, dateFormat)}`,
  );
  return [
    `active_assets: ${nonZero.length}`,
    "holdings:",
    holdings.length > 0 ? holdings.join("\n") : "- none",
    `recent_transactions: ${input.transactions.length}`,
    txLines.length > 0 ? txLines.join("\n") : "- none",
  ];
}

export function renderCoinbasePortfolioReport(input: CoinbaseRenderInput): string {
  const mode = input.mode === "detailed" ? "detailed" : "concise";
  const personalityComment = String(input.personalityComment || "").trim();
  const lines = [
    `Coinbase ${mode} portfolio report`,
    ...buildMetadataLines(input),
    ...(mode === "detailed" ? buildDetailedBody(input) : buildConciseBody(input)),
    ...(personalityComment ? [personalityComment] : []),
  ];
  return lines.join("\n");
}
