import { test } from "node:test";
import assert from "node:assert/strict";
import { OsmodaClient, OsmodaError, OsmodaPaymentRequired } from "../dist/index.js";

// Build a mock fetch from a handler(url, init) => { status, body, headers }.
function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init) || {};
    const status = r.status ?? 200;
    const headers = new Headers(r.headers || {});
    const body = r.body === undefined ? null : JSON.stringify(r.body);
    return new Response(body, { status, headers });
  };
  fn.calls = calls;
  return fn;
}

test("plans.list parses {plans:[]} and bare array", async () => {
  const c1 = new OsmodaClient({ fetch: mockFetch(() => ({ body: { plans: [{ id: "starter" }] } })) });
  assert.deepEqual(await c1.plans.list(), [{ id: "starter" }]);
  const c2 = new OsmodaClient({ fetch: mockFetch(() => ({ body: [{ id: "dev" }] })) });
  assert.deepEqual(await c2.plans.list(), [{ id: "dev" }]);
});

test("Bearer token is attached to authed calls", async () => {
  const f = mockFetch(() => ({ body: { order_id: "o1", status: "running" } }));
  const c = new OsmodaClient({ token: "osk_test", fetch: f });
  await c.status("o1");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer osk_test");
});

test("error envelope maps to OsmodaError with code/status/requestId/retryAfter", async () => {
  const f = mockFetch(() => ({
    status: 429,
    headers: { "x-request-id": "req_abc", "retry-after": "12" },
    body: { code: "rate_limited", message: "slow down" },
  }));
  const c = new OsmodaClient({ token: "osk_x", fetch: f });
  await assert.rejects(c.status("o1"), (e) => {
    assert.ok(e instanceof OsmodaError);
    assert.equal(e.code, "rate_limited");
    assert.equal(e.status, 429);
    assert.equal(e.requestId, "req_abc");
    assert.equal(e.retryAfter, 12);
    return true;
  });
});

test("spawn() with no wallet throws OsmodaPaymentRequired carrying the invoice", async () => {
  const invoice = { x402Version: 1, error: "Payment required", accepts: [{ scheme: "exact" }] };
  const f = mockFetch((url) => {
    assert.match(url, /\/api\/v1\/spawn\/starter$/);
    return { status: 402, headers: { "x-request-id": "req_402" }, body: invoice };
  });
  const c = new OsmodaClient({ fetch: f });
  await assert.rejects(c.spawn("starter", { idempotencyKey: "k-123456789012" }), (e) => {
    assert.ok(e instanceof OsmodaPaymentRequired);
    assert.deepEqual(e.paymentRequirements, invoice);
    assert.equal(e.requestId, "req_402");
    return true;
  });
  // Idempotency-Key header forwarded
  assert.equal(f.calls[0].init.headers["Idempotency-Key"], "k-123456789012");
});

test("spawn() success returns { order_id, token }", async () => {
  const f = mockFetch(() => ({ body: { order_id: "ord_1", token: "osk_minted" } }));
  const c = new OsmodaClient({ fetch: f });
  const r = await c.spawn("starter");
  assert.equal(r.order_id, "ord_1");
  assert.equal(r.token, "osk_minted");
});

test("spawnWithBalance() sends sk_live_ Bearer; 402 → insufficient_balance with detail", async () => {
  const f = mockFetch((url, init) => {
    assert.match(url, /\/api\/dashboard\/spawn$/);
    assert.equal(init.headers.Authorization, "Bearer sk_live_abc");
    return { status: 402, body: { error: "Insufficient balance", balance: 100, required: 500, shortfall: 400, message: "Need $5.00" } };
  });
  const c = new OsmodaClient({ fetch: f });
  await assert.rejects(c.spawnWithBalance("starter", { apiKey: "sk_live_abc" }), (e) => {
    assert.ok(e instanceof OsmodaError);
    assert.equal(e.code, "insufficient_balance");
    assert.equal(e.detail.shortfall, 400);
    return true;
  });
});

test("specKitProjects() is token-scoped (Bearer only, no X-Order-Id header)", async () => {
  const f = mockFetch(() => ({ body: { projects: [] } }));
  const c = new OsmodaClient({ token: "osk_sk", fetch: f });
  await c.specKitProjects();
  assert.match(f.calls[0].url, /\/api\/v1\/spec-kit\/projects$/);
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer osk_sk");
  assert.equal(f.calls[0].init.headers["X-Order-Id"], undefined);
});

test("waitUntilReady resolves on running and throws on failed", async () => {
  const cRun = new OsmodaClient({ token: "t", fetch: mockFetch(() => ({ body: { order_id: "o", status: "running", server_ip: "1.2.3.4" } })) });
  const s = await cRun.waitUntilReady("o", { intervalMs: 1 });
  assert.equal(s.status, "running");

  const cFail = new OsmodaClient({ token: "t", fetch: mockFetch(() => ({ body: { order_id: "o", status: "failed" } })) });
  await assert.rejects(cFail.waitUntilReady("o", { intervalMs: 1 }), (e) => e.code === "spawn_failed");
});
