/**
 * Types for the osModa hosted-provisioning API (spawn.os.moda, v1).
 * Mirrors the live OpenAPI spec at https://spawn.os.moda/api/v1/docs.
 */

export type Runtime = "claude-code" | "openclaw";

export interface OsmodaClientOptions {
  /** API base URL. Default: https://spawn.os.moda */
  baseUrl?: string;
  /** Default osk_ Bearer token used for authed calls when one isn't passed per-call. */
  token?: string;
  /**
   * Optional x402 wallet/signer. When present, spawn() pays the USDC invoice and
   * retries automatically. Without it, spawn() throws OsmodaPaymentRequired.
   */
  wallet?: unknown;
  /** Custom fetch (e.g. for tests or a proxy). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Extra headers added to every request. */
  headers?: Record<string, string>;
}

export interface Plan {
  id: string;
  name: string;
  description?: string;
  price_usdc?: string | number;
  agents?: number;
  use_cases?: string[];
  [k: string]: unknown;
}

export interface Credential {
  label?: string;
  provider: "anthropic" | "openai" | string;
  type: "oauth" | "api_key";
  secret: string;
}

export interface SpawnOptions {
  /** osk_ token is not needed to spawn — payment authorizes it. */
  region?: string;
  runtime?: Runtime;
  default_model?: string;
  credentials?: Credential[];
  /** Legacy single-credential fields (auto-migrated server-side). */
  api_key?: string;
  ai_provider?: string;
  /** Idempotency-Key header (16–128 chars). Safe spawn retries for 24h. */
  idempotencyKey?: string;
  /** x402 wallet override for this spawn (else the client-level wallet is used). */
  wallet?: unknown;
  [k: string]: unknown;
}

export interface SpawnResult {
  order_id: string;
  /** osk_ Bearer token scoped to this order. */
  token: string;
  status?: string;
  [k: string]: unknown;
}

export interface ServerStatus {
  order_id: string;
  status: "provisioning" | "running" | "failed" | string;
  server_ip?: string | null;
  region?: string;
  runtime?: Runtime;
  /** Advisory health signals (treat status:"running" as canonical). */
  chat_responsive?: boolean;
  agent_last_frame_at?: string | null;
  has_api_key?: boolean;
  auto_restart_attempts?: number;
  auto_restart_status?: string | null;
  [k: string]: unknown;
}

export interface TokenInfo {
  token_id: string;
  order_id?: string;
  created_at?: string;
  [k: string]: unknown;
}

export interface RequestReceipt {
  request_id: string;
  action?: string;
  status?: "accepted" | "in_progress" | "completed" | "failed" | string;
  result?: unknown;
  failure?: { code?: string; fallback_recommendation?: string } | null;
  [k: string]: unknown;
}

/** A frame streamed back over the chat WebSocket. */
export type ChatEvent =
  | { type: "status"; agent_connected?: boolean }
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; target?: string }
  | { type: "tool_result"; outcome?: string }
  | { type: "done" }
  | { type: "error"; text: string; code?: string }
  | { type: "backpressure_pause" }
  | { type: "backpressure_resume" };

/** A server-plane event from the SSE stream. */
export interface ServerEvent {
  id?: number;
  type: string; // request.accepted | request.progress | request.completed | request.failed | state.changed | agent.wedged | agent.healed | heartbeat.received | install.progress | ...
  request_id?: string;
  [k: string]: unknown;
}

export interface AgentCard {
  name?: string;
  description?: string;
  skills?: unknown[];
  [k: string]: unknown;
}
