type EndpointState = {
  state: "closed" | "open" | "half_open";
  failureCount: number;
  openedAtMs: number;
  halfOpenProbeInFlight: boolean;
};

const DEFAULT_FAILURE_THRESHOLD = Math.max(
  1,
  Number.parseInt(process.env.NOVA_COINBASE_CB_FAILURE_THRESHOLD || "5", 10) || 5,
);
const DEFAULT_COOLDOWN_MS = Math.max(
  5_000,
  Number.parseInt(process.env.NOVA_COINBASE_CB_COOLDOWN_MS || "60000", 10) || 60_000,
);

export class CoinbaseCircuitBreaker {
  private readonly states = new Map<string, EndpointState>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(input?: { failureThreshold?: number; cooldownMs?: number }) {
    this.failureThreshold = Math.max(1, Math.floor(Number(input?.failureThreshold || DEFAULT_FAILURE_THRESHOLD)));
    this.cooldownMs = Math.max(5_000, Math.floor(Number(input?.cooldownMs || DEFAULT_COOLDOWN_MS)));
  }

  public canRequest(endpoint: string, nowMs = Date.now()): { ok: true } | { ok: false; reason: string; retryAfterMs: number } {
    const state = this.getState(endpoint);
    if (state.state === "closed") return { ok: true };
    if (state.state === "open") {
      const elapsed = nowMs - state.openedAtMs;
      if (elapsed >= this.cooldownMs) {
        state.state = "half_open";
        state.halfOpenProbeInFlight = false;
      } else {
        return {
          ok: false,
          reason: "circuit_open",
          retryAfterMs: Math.max(0, this.cooldownMs - elapsed),
        };
      }
    }
    if (state.state === "half_open") {
      if (state.halfOpenProbeInFlight) {
        return { ok: false, reason: "circuit_half_open_probe_in_flight", retryAfterMs: this.cooldownMs };
      }
      state.halfOpenProbeInFlight = true;
      return { ok: true };
    }
    return { ok: true };
  }

  public onSuccess(endpoint: string): void {
    const state = this.getState(endpoint);
    state.state = "closed";
    state.failureCount = 0;
    state.openedAtMs = 0;
    state.halfOpenProbeInFlight = false;
  }

  public onFailure(endpoint: string, nowMs = Date.now()): void {
    const state = this.getState(endpoint);
    if (state.state === "half_open") {
      state.state = "open";
      state.failureCount = this.failureThreshold;
      state.openedAtMs = nowMs;
      state.halfOpenProbeInFlight = false;
      return;
    }
    state.failureCount += 1;
    if (state.failureCount >= this.failureThreshold) {
      state.state = "open";
      state.openedAtMs = nowMs;
    }
  }

  public snapshot(): Record<string, unknown> {
    const endpoints: Record<string, unknown> = {};
    for (const [endpoint, state] of this.states.entries()) {
      endpoints[endpoint] = {
        state: state.state,
        failureCount: state.failureCount,
        openedAtMs: state.openedAtMs,
        halfOpenProbeInFlight: state.halfOpenProbeInFlight,
      };
    }
    return {
      failureThreshold: this.failureThreshold,
      cooldownMs: this.cooldownMs,
      endpoints,
    };
  }

  private getState(endpoint: string): EndpointState {
    const key = String(endpoint || "unknown").trim() || "unknown";
    const existing = this.states.get(key);
    if (existing) return existing;
    const created: EndpointState = {
      state: "closed",
      failureCount: 0,
      openedAtMs: 0,
      halfOpenProbeInFlight: false,
    };
    this.states.set(key, created);
    return created;
  }
}
