# Auth & payments

## Two ways to pay for spawns

1. **x402 per-spawn (USDC, Base/Solana)** — the `POST /api/v1/spawn` surface this
   SDK targets. No account needed. Supported by `OsmodaClient.spawn()`.
2. **Prepaid balance + `sk_live_` API key** — top up a balance (Stripe card or
   crypto deposit), create a `sk_live_` key, and spawn from balance via the
   dashboard surface (`POST /api/dashboard/spawn`). Top up once, spawn many; the
   server deducts from balance atomically and returns *"Insufficient balance —
   add funds first"* when short. **Not yet wrapped by this SDK** (roadmap) — call
   the dashboard endpoint directly with `Authorization: Bearer sk_live_…` for now.

## Two auth modes (for the x402 / `osk_` surface this SDK covers)

1. **x402 payment** — only for `POST /api/v1/spawn/:planId`. USDC on Base or Solana.
2. **`osk_` Bearer token** — everything after spawn. Returned by `spawn()` as
   `result.token`. Pass it per-call (`{ token }`) or set a client default
   (`new OsmodaClient({ token })`).

Free, no-auth endpoints: `plans.list()`, basic `status()`, `agentCard()`, `openapi()`.

## Paying for a spawn (x402)

```ts
// auto: pass a wallet, SDK does 402 → pay → retry
const osmoda = new OsmodaClient({ wallet: myWallet });
await osmoda.spawn("starter");

// manual: no wallet → catch the invoice and pay your own way
import { OsmodaPaymentRequired } from "@osmoda/sdk";
try {
  await new OsmodaClient().spawn("starter");
} catch (e) {
  if (e instanceof OsmodaPaymentRequired) {
    const invoice = e.paymentRequirements; // raw x402 requirements
    // …pay, then retry with the resulting payment header via a custom fetch…
  }
}
```

`@x402/core` + a chain adapter (`@x402/evm` or `@x402/solana`) are **optional**
peer deps — install them only for the auto-pay path.

## Idempotency

Pass `idempotencyKey` (16–128 chars) to `spawn()`; it's sent as the
`Idempotency-Key` header and de-duplicated for 24h, so retries never double-charge.

## Rate limits

Per token: **spawn 10/h**, **status 120/min**. `429` responses include
`Retry-After` (seconds); `OsmodaError.retryAfter` surfaces it and
`waitUntilReady()` honors it automatically.

## Token lifecycle

```ts
await osmoda.tokens.get("TOKEN_ID");      // metadata (own token only)
await osmoda.tokens.revoke("TOKEN_ID");   // revoke when done
```

Mint a token per user/session; revoke when the work is finished.
