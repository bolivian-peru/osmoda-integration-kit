<div align="center">

# osmoda-integration-kit

**Spawn an AI agent into your app in five lines.**

Spin up a dedicated AI-managed server, pay per spawn in USDC, and chat with its
agent live — over one clean TypeScript SDK.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![status](https://img.shields.io/badge/status-preview%20v0.1-orange.svg)](#status)
[![API](https://img.shields.io/badge/api-spawn.os.moda-111.svg)](https://spawn.os.moda/api/v1/docs)

</div>

> ### Status
> **Preview (v0.1). Not yet on npm.** The SDK builds, the API surface is mapped
> from the live OpenAPI spec, and it is **unit-tested** (mocked fetch / WS / SSE —
> request building, auth, error envelope, x402 402 handling, balance spawn, chat
> frame parsing, SSE). x402 auto-pay uses the real `@x402/fetch`
> `wrapFetchWithPayment` API. **Still pending:** a live end-to-end run against a
> funded server, then the npm publish. Treat APIs as unstable until v1.0. Until
> it's on npm, install from source (see [Install](#install)). Progress in
> [issues](https://github.com/bolivian-peru/osmoda-integration-kit/issues).

---

## TL;DR (for humans)

osModa servers are **dedicated AI workers in the cloud** — each one is its own
machine with an AI agent that can run commands, build and deploy apps, scrape,
automate, and keep working 24/7. This kit turns "spin one up and put it to work"
into a few lines of code.

- **Spawn** a server (a dedicated cloud VM) and **pay per spawn in USDC** — no
  accounts or API keys to manage.
- **Chat** with its agent live over WebSocket, or **watch** what it's doing via
  an event stream.
- **Compose** it into anything: a "give every customer their own AI box" button,
  an autonomous agent that hires its own helper, or an internal tool.

### Install

Not on npm yet — install from source while it's in preview:

```bash
git clone https://github.com/bolivian-peru/osmoda-integration-kit
cd osmoda-integration-kit && npm install && npm run build
# then import from the built dist/, or `npm link` it into your project
```

```ts
import { OsmodaClient } from "@osmoda/sdk";

const osmoda = new OsmodaClient({ wallet: myWallet }); // wallet pays the spawn invoice

// Spin up a server and wait until it's live
const { order_id, token } = await osmoda.spawnAndWait("starter", {
  runtime: "claude-code",
  credentials: [{ provider: "anthropic", type: "api_key", secret: process.env.ANTHROPIC_KEY }],
});

// Talk to it
const chat = osmoda.chat(order_id, { token });
chat.on("text", (delta) => process.stdout.write(delta));
chat.on("tool", (t) => console.log(`\n[${t.name} ${t.target ?? ""}]`));
await chat.send("Deploy a Next.js app on 127.0.0.1:3000 and report the URL.");
```

That's it. [Full quickstart →](./docs/quickstart.md)

---

## What you can build

| | |
|---|---|
| **AI workforce for your SaaS** | Give every customer their own AI ops/dev server behind one button. |
| **Agents that hire agents** | Let a LangChain / CrewAI / MCP agent spawn its *own* worker server and delegate real work (A2A / ERC-8004). |
| **Throwaway task runners** | Provision a box, run a job, tear it down. |

---

## For AI agents

If you're an AI agent (or building one) and want to drive osModa programmatically,
read **[`SKILL.md`](./SKILL.md)** — a complete machine-readable reference: every
endpoint mapped to an SDK method, the chat + event-stream protocols, the x402
payment flow, the typed error model, and a copy-paste **agent-to-agent recipe**
(one agent spawns and commissions another). Discovery is also available as an
[Agent Card](https://spawn.os.moda/.well-known/agent-card.json) (A2A / ERC-8004).

```ts
// give any agent the power to spawn its own worker and delegate
async function delegate(task: string) {
  const { order_id, token } = await osmoda.spawnAndWait("starter", { wallet });
  return osmoda.chat(order_id, { token }).ask(task); // returns the worker's reply
}
```

---

## The SDK at a glance

| What | How |
|---|---|
| List plans (free) | `osmoda.plans.list()` |
| Spawn a server (x402-paid) | `osmoda.spawn(planId, opts)` · `osmoda.spawnAndWait(...)` |
| Wait until live | `osmoda.waitUntilReady(orderId, { token })` |
| Live chat (WebSocket) | `osmoda.chat(orderId, { token })` → `.send()`, `.ask()`, events `text·tool·done·error` |
| Event stream (SSE) | `osmoda.events(orderId, { token })` |
| History · receipts · logs | `osmoda.history()` · `osmoda.requests()` · `osmoda.spawnLog()` |
| Restart a stuck agent | `osmoda.restartAgent(orderId, agentId)` |
| Deliver a credential | `osmoda.setApiKey(orderId, credential)` |
| Token management | `osmoda.tokens.get(id)` · `osmoda.tokens.revoke(id)` |

Streaming is handled for you: `ChatSession` does heartbeat, backpressure, and
auto-reconnect; `EventStream` is cursor-resumable. Errors throw a typed
`OsmodaError` (`code`, `status`, `requestId`, `retryAfter`).

---

## Auth & payments

- **Spawning** is gated by [x402](https://x402.org) — USDC on Base or Solana.
  Pass a `wallet` and the SDK pays the invoice and retries; omit it and `spawn()`
  hands you the invoice (`OsmodaPaymentRequired`) to pay your own way.
- **Everything after spawn** uses the `osk_` Bearer token returned by spawn.
- Per-token limits: 10 spawns/h, 120 status/min. Spawn is idempotent via
  `idempotencyKey`.

Details: [`docs/auth-and-payments.md`](./docs/auth-and-payments.md).

---

## Examples

- [`examples/cli`](./examples/cli) — spawn + interactive terminal chat
- [`examples/langchain-tool`](./examples/langchain-tool) — an agent that spawns its own osModa worker
- [`examples/nextjs-spawn-chat`](./examples/nextjs-spawn-chat) — a web app: spawn + live chat

## Docs

- [`SKILL.md`](./SKILL.md) — complete integration reference (for agents & devs)
- [`docs/quickstart.md`](./docs/quickstart.md)
- [`docs/chat-streaming.md`](./docs/chat-streaming.md)
- [`docs/auth-and-payments.md`](./docs/auth-and-payments.md)
- [`docs/errors.md`](./docs/errors.md)

## Staying in sync

The SDK tracks the live OpenAPI spec at
[`spawn.os.moda/api/v1/docs`](https://spawn.os.moda/api/v1/docs). A vendored
snapshot lives in [`spec/openapi.json`](./spec/openapi.json); CI re-fetches it
nightly and fails on drift, so the kit can't fall behind the backend.

## Links

- API base: https://spawn.os.moda
- osModa (the OS): https://github.com/bolivian-peru/os-moda

## License

[Apache-2.0](./LICENSE).
