/**
 * OsmodaClient — ergonomic wrapper over the spawn.os.moda v1 API.
 *
 * Covers every public v1 route, plus convenience flows (spawnAndWait,
 * waitUntilReady) and the x402 pay→retry dance. See README + SKILL.md.
 */

import type {
  OsmodaClientOptions, Plan, SpawnOptions, SpawnResult, ServerStatus,
  TokenInfo, RequestReceipt, AgentCard, Credential, Runtime,
} from "./types.js";
import { OsmodaError, OsmodaPaymentRequired, errorFromResponse } from "./errors.js";
import { makePaymentFetch } from "./x402.js";
import { ChatSession } from "./chat.js";
import { EventStream } from "./events.js";

const DEFAULT_BASE_URL = "https://spawn.os.moda";

export class OsmodaClient {
  readonly baseUrl: string;
  private readonly token?: string;
  private readonly wallet?: unknown;
  private readonly fetchImpl: typeof fetch;
  private readonly extraHeaders: Record<string, string>;

  constructor(opts: OsmodaClientOptions = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.token = opts.token;
    this.wallet = opts.wallet;
    this.fetchImpl = opts.fetch || fetch;
    this.extraHeaders = opts.headers || {};
  }

  // ── low-level request ──────────────────────────────────────────────────
  private async request<T>(
    method: string,
    path: string,
    init: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Osmoda-Sdk": "ts/0.1.0",
      ...this.extraHeaders,
      ...init.headers,
    };
    const token = init.token ?? this.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body });
    if (res.status === 204) return undefined as T;
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as T;
  }

  // ── plans (free) ─────────────────────────────────────────────────────────
  plans = {
    list: (): Promise<Plan[]> =>
      this.request<{ plans?: Plan[] } | Plan[]>("GET", "/api/v1/plans").then((r) =>
        Array.isArray(r) ? r : r.plans || [],
      ),
  };

  // ── spawn (x402-gated) ─────────────────────────────────────────────────
  /**
   * Spawn a dedicated osModa server (a Hetzner cloud VM with the agent stack).
   * If a wallet is configured the USDC invoice is paid automatically; otherwise
   * throws OsmodaPaymentRequired carrying the invoice.
   */
  async spawn(planId: string, opts: SpawnOptions = {}): Promise<SpawnResult> {
    const { idempotencyKey, wallet, ...payload } = opts;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Osmoda-Sdk": "ts/0.1.0",
      ...this.extraHeaders,
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const url = `${this.baseUrl}/api/v1/spawn/${encodeURIComponent(planId)}`;
    const init: RequestInit = { method: "POST", headers, body: JSON.stringify(payload) };

    // Choose the fetch: if a wallet is supplied, wrap our fetch with @x402/fetch
    // so the 402→pay→retry happens transparently. If the caller already passed a
    // payment-wrapped fetch as `this.fetchImpl`, that handles it too.
    const w = wallet ?? this.wallet;
    const doFetch: typeof fetch = w ? await makePaymentFetch(this.fetchImpl, w) : this.fetchImpl;

    const res = await doFetch(url, init);

    // Unpaid + no wallet → hand back the x402 invoice ({x402Version,error,accepts}).
    if (res.status === 402) {
      const requestId = res.headers.get("x-request-id") || undefined;
      const invoice = await res.json().catch(() => ({}));
      throw new OsmodaPaymentRequired({
        message:
          "Spawn requires payment (x402). Pass a `wallet` (with @x402/fetch installed) or a " +
          "payment-wrapped `fetch` to pay automatically, or pay the returned invoice yourself.",
        requestId,
        paymentRequirements: invoice,
      });
    }

    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as SpawnResult;
  }

  /**
   * Spawn paying from a prepaid account balance, authenticated with an
   * `sk_live_` API key (top up once, spawn many — no crypto wallet needed).
   * Wraps `POST /api/dashboard/spawn`. Returns `{ order_id }` (note: this path
   * does NOT mint an `osk_` token — see the README "Two ways to pay" note for
   * the chat-surface caveat). Throws OsmodaError (code `insufficient_balance`)
   * with `{ balance, required, shortfall }` in `detail` when funds are short.
   */
  async spawnWithBalance(
    planId: string,
    opts: { apiKey: string; region?: string; runtime?: Runtime; default_model?: string; credentials?: Credential[]; ssh_key?: string } ,
  ): Promise<{ order_id: string; [k: string]: unknown }> {
    const { apiKey, ...rest } = opts;
    const res = await this.fetchImpl(`${this.baseUrl}/api/dashboard/spawn`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Osmoda-Sdk": "ts/0.1.0",
        ...this.extraHeaders,
      },
      body: JSON.stringify({ plan_id: planId, ...rest }),
    });
    if (res.status === 402) {
      const body = await res.json().catch(() => ({}));
      throw new OsmodaError({
        code: "insufficient_balance",
        message: body.message || "Insufficient balance — add funds first.",
        status: 402,
        detail: body,
        requestId: res.headers.get("x-request-id") || undefined,
      });
    }
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as { order_id: string };
  }

  /** spawn() + waitUntilReady() in one call. */
  async spawnAndWait(planId: string, opts: SpawnOptions & { timeoutMs?: number } = {}): Promise<SpawnResult> {
    const result = await this.spawn(planId, opts);
    await this.waitUntilReady(result.order_id, { token: result.token, timeoutMs: opts.timeoutMs });
    return result;
  }

  // ── status ───────────────────────────────────────────────────────────────
  status(orderId: string, opts: { token?: string } = {}): Promise<ServerStatus> {
    return this.request<ServerStatus>("GET", `/api/v1/status/${encodeURIComponent(orderId)}`, { token: opts.token });
  }

  /** Poll status until `running` (or failed/timeout). Respects Retry-After. */
  async waitUntilReady(
    orderId: string,
    opts: { token?: string; timeoutMs?: number; intervalMs?: number; onUpdate?: (s: ServerStatus) => void } = {},
  ): Promise<ServerStatus> {
    const deadline = Date.now() + (opts.timeoutMs ?? 12 * 60 * 1000);
    let interval = opts.intervalMs ?? 5000;
    for (;;) {
      let s: ServerStatus;
      try {
        s = await this.status(orderId, { token: opts.token });
      } catch (e) {
        if (e instanceof OsmodaError && e.status === 429 && e.retryAfter) {
          await sleep(e.retryAfter * 1000);
          continue;
        }
        throw e;
      }
      opts.onUpdate?.(s);
      if (s.status === "running") return s;
      if (s.status === "failed") throw new OsmodaError({ code: "spawn_failed", message: "Server provisioning failed", status: 200, detail: s });
      if (Date.now() > deadline) throw new OsmodaError({ code: "timeout", message: `Server not ready within timeout`, status: 408, detail: s });
      await sleep(interval);
      interval = Math.min(interval * 1.25, 15000);
    }
  }

  // ── chat + events ──────────────────────────────────────────────────────
  chat(orderId: string, opts: { token?: string } = {}): ChatSession {
    const token = opts.token ?? this.token;
    if (!token) throw new OsmodaError({ code: "no_token", message: "chat requires an osk_ token", status: 401 });
    return new ChatSession({ baseUrl: this.baseUrl, orderId, token });
  }

  events(orderId: string, opts: { token?: string; cursor?: number; filter?: string } = {}): EventStream {
    const token = opts.token ?? this.token;
    if (!token) throw new OsmodaError({ code: "no_token", message: "events requires an osk_ token", status: 401 });
    return new EventStream({ baseUrl: this.baseUrl, orderId, token, cursor: opts.cursor, filter: opts.filter, fetchImpl: this.fetchImpl });
  }

  // ── history + receipts ───────────────────────────────────────────────────
  history(orderId: string, opts: { token?: string } = {}): Promise<unknown> {
    return this.request("GET", `/api/v1/servers/${encodeURIComponent(orderId)}/chat-history`, { token: opts.token });
  }
  requests(orderId: string, opts: { token?: string } = {}): Promise<RequestReceipt[]> {
    return this.request("GET", `/api/v1/servers/${encodeURIComponent(orderId)}/requests`, { token: opts.token });
  }
  request_(orderId: string, requestId: string, opts: { token?: string } = {}): Promise<RequestReceipt> {
    return this.request("GET", `/api/v1/servers/${encodeURIComponent(orderId)}/requests/${encodeURIComponent(requestId)}`, { token: opts.token });
  }
  /** NDJSON spawn/provision log as raw text. */
  async spawnLog(orderId: string, opts: { token?: string } = {}): Promise<string> {
    const token = opts.token ?? this.token;
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/servers/${encodeURIComponent(orderId)}/spawn-log`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw await errorFromResponse(res);
    return res.text();
  }

  // ── lifecycle actions ────────────────────────────────────────────────────
  restartAgent(orderId: string, agentId: string, opts: { token?: string } = {}): Promise<RequestReceipt> {
    return this.request("POST", `/api/v1/servers/${encodeURIComponent(orderId)}/agents/${encodeURIComponent(agentId)}/restart`, { token: opts.token });
  }
  setApiKey(orderId: string, credential: Credential, opts: { token?: string } = {}): Promise<RequestReceipt> {
    return this.request("POST", `/api/v1/servers/${encodeURIComponent(orderId)}/api-key`, { body: credential, token: opts.token });
  }
  /** Spec-kit projects on the server the token belongs to (scope is derived from the Bearer token). */
  specKitProjects(opts: { token?: string } = {}): Promise<unknown> {
    return this.request("GET", `/api/v1/spec-kit/projects`, { token: opts.token });
  }

  // ── tokens ───────────────────────────────────────────────────────────────
  tokens = {
    get: (tokenId: string, opts: { token?: string } = {}): Promise<TokenInfo> =>
      this.request("GET", `/api/v1/tokens/${encodeURIComponent(tokenId)}`, { token: opts.token }),
    revoke: (tokenId: string, opts: { token?: string } = {}): Promise<void> =>
      this.request("DELETE", `/api/v1/tokens/${encodeURIComponent(tokenId)}`, { token: opts.token }),
  };

  // ── discovery ──────────────────────────────────────────────────────────
  agentCard(): Promise<AgentCard> {
    return this.request("GET", `/.well-known/agent-card.json`);
  }
  /** The raw OpenAPI 3.0.3 spec the SDK is built against. */
  openapi(): Promise<unknown> {
    return this.request("GET", `/api/v1/docs`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
