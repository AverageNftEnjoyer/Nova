import type { CoinbasePortfolioSnapshot, CoinbaseTransactionEvent } from "./types.js";

export type CoinbaseReportMode = "concise" | "detailed";

export interface CoinbaseRenderInput {
  mode: CoinbaseReportMode;
  source: string;
  generatedAtMs: number;
  portfolio: CoinbasePortfolioSnapshot;
  transactions: CoinbaseTransactionEvent[];
}

function formatUsd(value: number | null | undefined): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "n/a";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
}

function formatNumber(value: number | null | undefined): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "n/a";
  return amount.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function formatTimestamp(valueMs: number): string {
  const ts = Number(valueMs);
  if (!Number.isFinite(ts) || ts <= 0) return "unknown";
  return new Date(ts).toISOString();
}

function formatFreshness(valueMs: number): string {
  const age = Number(valueMs);
  if (!Number.isFinite(age) || age < 0) return "unknown";
  return `${Math.round(age / 1000)}s`;
}

function buildMetadataLines(input: CoinbaseRenderInput): string[] {
  return [
    `timestamp: ${formatTimestamp(input.generatedAtMs)}`,
    `freshness: ${formatFreshness(input.portfolio.freshnessMs)}`,
    `source: ${String(input.source || input.portfolio.source || "coinbase")}`,
  ];
}

function buildConciseBody(input: CoinbaseRenderInput): string[] {
  const nonZero = input.portfolio.balances.filter((entry) => Number(entry.total || 0) > 0);
  const top = nonZero.slice(0, 4).map((entry) => `${entry.assetSymbol}: ${formatNumber(entry.total)}`);
  return [
    `active_assets: ${nonZero.length}`,
    `recent_transactions: ${input.transactions.length}`,
    top.length > 0 ? `top_holdings: ${top.join(" | ")}` : "top_holdings: none",
  ];
}

function buildDetailedBody(input: CoinbaseRenderInput): string[] {
  const nonZero = input.portfolio.balances.filter((entry) => Number(entry.total || 0) > 0);
  const holdings = nonZero.slice(0, 12).map(
    (entry) =>
      `- ${entry.assetSymbol}: total=${formatNumber(entry.total)} available=${formatNumber(entry.available)} hold=${formatNumber(entry.hold)}`,
  );
  const txLines = input.transactions.slice(0, 12).map(
    (event) =>
      `- ${event.side.toUpperCase()} ${formatNumber(event.quantity)} ${event.assetSymbol} @ ${formatUsd(event.price)} fee=${formatUsd(event.fee)} at=${formatTimestamp(event.occurredAtMs)}`,
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
  const lines = [
    `Coinbase ${mode} portfolio report`,
    ...buildMetadataLines(input),
    ...(mode === "detailed" ? buildDetailedBody(input) : buildConciseBody(input)),
  ];
  return lines.join("\n");
}
