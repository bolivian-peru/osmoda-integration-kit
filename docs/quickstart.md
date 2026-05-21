# Quickstart

> **Preview (v0.1):** not on npm yet — install from source:
> `git clone https://github.com/bolivian-peru/osmoda-integration-kit && npm install && npm run build`.

```bash
# (once published) npm install @osmoda/sdk
# optional, only to auto-pay spawn invoices:
npm install @x402/core @x402/evm
```

```ts
import { OsmodaClient } from "@osmoda/sdk";

const osmoda = new OsmodaClient({ wallet: myWallet });

// 1. browse plans (free)
const plans = await osmoda.plans.list();

// 2. spawn + wait (provisions a Hetzner cloud VM; first boot ~5–10 min)
const { order_id, token } = await osmoda.spawnAndWait("starter", {
  region: "eu-central",
  runtime: "claude-code",
  default_model: "claude-opus-4-7",
  credentials: [{ provider: "anthropic", type: "api_key", secret: process.env.ANTHROPIC_KEY! }],
  idempotencyKey: "order-0001",
});

// 3. chat
const reply = await osmoda.chat(order_id, { token }).ask("What services are running?");
console.log(reply);
```

Already have a server? Skip spawn:

```ts
const osmoda = new OsmodaClient({ token: "osk_…" });
const status = await osmoda.status("ORDER_ID");
const chat = osmoda.chat("ORDER_ID");          // uses the client default token
```

See [`SKILL.md`](../SKILL.md) for every endpoint mapped to an SDK method.
