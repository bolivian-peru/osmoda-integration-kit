# osmoda-integration-kit — Agent Skill Document

> Machine-readable reference for integrating **osModa spawnable AI agents** into
> any app via the `@osmoda/sdk` TypeScript SDK and the `spawn.os.moda` v1 API.
> If you are an AI agent or developer wiring osModa into a product, read this top
> to bottom — every public endpoint, auth path, and streaming protocol is here.

- **SDK package:** `@osmoda/sdk` (TypeScript / ESM, Node ≥18, browser-friendly)
- **API base URL:** `https://spawn.os.moda`
- **OpenAPI 3.0.3 spec (source of truth):** `https://spawn.os.moda/api/v1/docs`
- **Agent Card (A2A / ERC-8004):** `https://spawn.os.moda/.well-known/agent-card.json`
- **Upstream OS:** [bolivian-peru/os-moda](https://github.com/bolivian-peru/os-moda)

---

## 1. What this lets you build

`@osmoda/sdk` spins up **dedicated osModa servers** (each a cloud VM — Hetzner
Cloud by default — running a root-capable AI agent with 92 structured tools, an
audit ledger, and atomic NixOS rollback), pays for them with **USDC via x402**,
and gives you **live WebSocket chat** + an **SSE event plane** to drive them.

Typical use cases:
- A SaaS "give every customer their own AI ops/dev box" button.
- An autonomous agent (LangChain/CrewAI/MCP) that **spawns its own worker server**
  and delegates real infra/dev/scraping work to it.
- A CLI / internal tool that provisions a throwaway agent box, runs a task, tears it down.

---

## 2. Install & construct

> **Preview (v0.1):** not yet published to npm. Install from source —
> `git clone … && npm install && npm run build` — then `npm link` or import from
> `dist/`. No tests yet; treat APIs as unstable.

```bash
# once published it will be: npm install @osmoda/sdk
npm install @osmoda/sdk
# optional, only to auto-pay spawn invoices:
npm install @x402/core @x402/evm     # Base (EVM)   — or @x402/solana for Solana
# optional, only on Node < 22 (older runtimes lack a global WebSocket):
npm install ws
```

```ts
import { OsmodaClient } from "@osmoda/sdk";

const osmoda = new OsmodaClient({
  baseUrl: "https://spawn.os.moda",  // default
  token: "osk_…",                    // optional default Bearer token for authed calls
  wallet: myWallet,                  // optional x402 signer (viem / solana)
});
```

---

## 3. Auth model

| Action | Auth |
|---|---|
| `GET /api/v1/plans`, `GET /api/v1/status/:id` (basic), `GET /.well-known/agent-card.json`, `GET /api/v1/docs` | none |
| `POST /api/v1/spawn/:planId` | **x402 payment** (USDC, Base or Solana) |
| Everything else (`status` full, chat WS, events SSE, history, requests, restart, api-key, tokens, spec-kit) | **`Authorization: Bearer osk_…`** (the token returned by spawn) |

- Every response carries an **`X-Request-Id`** header.
- Errors use a uniform envelope: `{ code, message, detail?, request_id, error }`
  (`error` is a legacy alias for `code`). The SDK throws a typed `OsmodaError`
  (`.code`, `.status`, `.detail`, `.requestId`, `.retryAfter`).
- Rate limits: **spawn 10/h**, **status 120/min** per token. `429` responses
  carry `Retry-After` (seconds); `waitUntilReady()` honors it automatically.
- Idempotency: pass `idempotencyKey` (16–128 chars) to `spawn()` → sent as
  `Idempotency-Key`; safe retries are de-duplicated for 24h.

---

## 4. The full flow (spin up a Hetzner server + chat)

```ts
// 1. (free) list plans
const plans = await osmoda.plans.list();

// 2. spawn — pays the x402 invoice if a wallet is set, else throws
//    OsmodaPaymentRequired with the invoice. Returns { order_id, token }.
const { order_id, token } = await osmoda.spawn("starter", {
  region: "eu-central",            // Hetzner region hint
  runtime: "claude-code",          // or "openclaw"
  default_model: "claude-opus-4-7",
  credentials: [
    { provider: "anthropic", type: "api_key", secret: process.env.ANTHROPIC_KEY! },
  ],
  idempotencyKey: "order-2026-0001",
});

// 3. wait until provisioned (polls status with backoff; ~5–10 min first boot)
await osmoda.waitUntilReady(order_id, { token, onUpdate: (s) => console.log(s.status) });

// 4. chat (WebSocket, streaming, auto-reconnect)
const chat = osmoda.chat(order_id, { token });
chat.on("text", (delta) => process.stdout.write(delta));
chat.on("tool", (t) => console.log(`\n[${t.name} ${t.target ?? ""}]`));
chat.on("done", () => console.log("\n— done"));
await chat.send("Deploy a Next.js app on 127.0.0.1:3000 and report the URL.");

// or one-shot:
const reply = await chat.ask("What services are running?");
```

---

## 5. Every public v1 endpoint → SDK method

| Method + path | Auth | SDK |
|---|---|---|
| `GET /api/v1/plans` | none | `osmoda.plans.list()` |
| `POST /api/v1/spawn/:planId` | x402 | `osmoda.spawn(planId, opts)` · `osmoda.spawnAndWait(planId, opts)` |
| `GET /api/v1/status/:orderId` | none / Bearer | `osmoda.status(orderId, {token})` · `osmoda.waitUntilReady(orderId, …)` |
| `GET /api/v1/tokens/:token_id` | Bearer | `osmoda.tokens.get(id, {token})` |
| `DELETE /api/v1/tokens/:token_id` | Bearer | `osmoda.tokens.revoke(id, {token})` |
| `WS /api/v1/chat/:orderId?token=osk_` | token (query) | `osmoda.chat(orderId, {token})` |
| `GET /api/v1/servers/:orderId/events` (SSE) | Bearer | `osmoda.events(orderId, {token, cursor, filter})` |
| `GET /api/v1/servers/:orderId/requests` | Bearer | `osmoda.requests(orderId, {token})` |
| `GET /api/v1/servers/:orderId/requests/:request_id` | Bearer | `osmoda.request_(orderId, requestId, {token})` |
| `GET /api/v1/servers/:orderId/chat-history` | Bearer | `osmoda.history(orderId, {token})` |
| `GET /api/v1/servers/:orderId/spawn-log` (NDJSON) | Bearer | `osmoda.spawnLog(orderId, {token})` |
| `POST /api/v1/servers/:orderId/agents/:agentId/restart` | Bearer | `osmoda.restartAgent(orderId, agentId, {token})` |
| `POST /api/v1/servers/:orderId/api-key` | Bearer | `osmoda.setApiKey(orderId, credential, {token})` |
| `GET /api/v1/spec-kit/projects` | Bearer | `osmoda.specKitProjects(orderId, {token})` |
| `GET /.well-known/agent-card.json` | none | `osmoda.agentCard()` |
| `GET /api/v1/docs` | none | `osmoda.openapi()` |

---

## 6. Chat WebSocket protocol

`WS /api/v1/chat/:orderId?token=osk_…`

- **Client → server:** `{ "type": "chat", "text": "…" }` or `{ "type": "abort" }`
- **Server → client frames:**
  - `{ type: "status", agent_connected }`
  - `{ type: "text", text }` — incremental reply delta
  - `{ type: "tool_use", name, target }` — `target` is a command/path/url preview
  - `{ type: "tool_result", outcome }`
  - `{ type: "done" }`
  - `{ type: "error", text, code }`
  - `{ type: "backpressure_pause" }` / `{ type: "backpressure_resume" }`
- 30 s server heartbeat; idle sockets close after 10 min (code `4003`); **max 3
  concurrent sessions per token**.
- The SDK's `ChatSession` maps these to `.on("text" | "tool" | "tool_result" |
  "done" | "error" | "backpressure" | "status" | "open" | "reconnecting" | "close")`,
  auto-reconnects with backoff on unexpected drops, and offers `ask()` for
  one-shot request/response.

---

## 7. Server event plane (SSE)

`GET /api/v1/servers/:orderId/events` (Bearer, cursor-resumable, 15 s keepalive).
Event `type`s: `request.accepted` · `request.progress` · `request.completed` ·
`request.failed` · `state.changed` (e.g. `has_api_key` flips) · `agent.wedged` ·
`agent.healed` · `heartbeat.received` · `install.progress`.

```ts
const stream = osmoda.events(order_id, { token, filter: "request,state,agent" });
stream.on("request.completed", (e) => console.log("done:", e.request_id));
stream.on((e) => console.log(e.type, e.id));   // all events
stream.start();                                 // resumes from cursor on drops
// later: stream.close();
```

---

## 8. Payment options

osModa supports two ways to pay for spawns:

1. **x402 per-spawn (USDC on Base/Solana)** — the public `POST /api/v1/spawn/:planId`
   surface this SDK targets. Pay-as-you-go, no account needed. **Supported by this SDK.**
2. **Prepaid account balance + `sk_live_` API key** — top up a balance (card via
   Stripe, or crypto deposit), generate a `sk_live_` key, and spawn from balance
   via the dashboard surface (`POST /api/dashboard/spawn`, atomic balance deduct).
   Easier for many integrators (no wallet). **Not yet wrapped by this SDK** — on
   the roadmap; for now use the dashboard surface directly with your `sk_live_` key.

### x402 (option 1) details

Spawning via `/api/v1/spawn` is x402 payment-gated (USDC on Base or Solana).
- With a `wallet` (client- or call-level), `spawn()` handles `402 → pay → retry`.
- Without one, `spawn()` throws **`OsmodaPaymentRequired`** carrying
  `.paymentRequirements` (the raw invoice) so you can pay it yourself and retry.
- `@x402/core` + a chain adapter (`@x402/evm` / `@x402/solana`) are **optional**
  peer deps; the SDK works fully for free endpoints without them.

---

## 9. Errors

```ts
import { OsmodaError, OsmodaPaymentRequired } from "@osmoda/sdk";
try {
  await osmoda.spawn("starter");
} catch (e) {
  if (e instanceof OsmodaPaymentRequired) { /* e.paymentRequirements */ }
  else if (e instanceof OsmodaError) { console.error(e.code, e.status, e.requestId, e.retryAfter); }
}
```

---

## 10. Agent-to-agent recipe (the novel one)

Give an autonomous agent the ability to spawn its own osModa worker and delegate:

```ts
// pseudo-LangChain tool — see examples/langchain-tool
const spawnTool = {
  name: "spawn_osmoda_agent",
  description: "Provision a dedicated AI server and run a task on it. Returns the agent's reply.",
  async call({ task }: { task: string }) {
    const { order_id, token } = await osmoda.spawnAndWait("starter", { wallet, runtime: "claude-code" });
    return osmoda.chat(order_id, { token }).ask(task);
  },
};
```

This is the A2A / ERC-8004 story end-to-end: one agent discovers osModa via the
Agent Card, pays via x402, and commissions another agent — no human in the loop.

---

## 11. Staying in sync with production

The SDK's typed surface tracks the live OpenAPI spec at
`https://spawn.os.moda/api/v1/docs`. Run `npm run codegen` to regenerate types
from the deployed spec; CI fails on drift so the kit can't fall behind the
backend. The endpoint table in §5 is the authoritative integration map.
