# Errors

All API errors share one envelope:

```json
{ "code": "…", "message": "…", "detail": null, "request_id": "req_…", "error": "…" }
```

(`error` is a legacy alias for `code`.) Every response — success or failure —
also carries an `X-Request-Id` header; quote it in support requests.

The SDK throws a typed `OsmodaError`:

```ts
import { OsmodaError, OsmodaPaymentRequired } from "@osmoda/sdk";

try {
  await osmoda.status("ORDER_ID");
} catch (e) {
  if (e instanceof OsmodaPaymentRequired) {
    // 402 on spawn with no wallet — e.paymentRequirements has the invoice
  } else if (e instanceof OsmodaError) {
    e.code;        // e.g. "gateway_wedged", "agent_disconnected", "http_404"
    e.status;      // HTTP status
    e.detail;      // server-provided detail (may be undefined)
    e.requestId;   // X-Request-Id
    e.retryAfter;  // seconds, present on 429
  }
}
```

## Notable codes

| `code` | Meaning | Suggested action |
|---|---|---|
| `payment_required` | Spawn needs x402 payment, no wallet supplied | Pay the invoice (`OsmodaPaymentRequired.paymentRequirements`) and retry |
| `gateway_wedged` | Agent gateway stalled | `osmoda.restartAgent(orderId, "osmoda")`, then retry |
| `gateway_unreachable` | Can't reach the customer gateway | Retry with backoff; check `status()` |
| `agent_disconnected` | Chat agent not connected | Retry; if persistent, restart the agent |
| `timeout` (SDK) | `waitUntilReady` exceeded its deadline | Increase `timeoutMs` or inspect `spawnLog()` |

503s for the gateway classes above include a `fallback_recommendation` in
`detail`. `429` always includes `Retry-After`.
