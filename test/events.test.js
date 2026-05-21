import { test } from "node:test";
import assert from "node:assert/strict";
import { OsmodaClient } from "../dist/index.js";

// First call returns the events stream then closes; subsequent calls return a
// pending stream (never closes) so the reconnect loop blocks until close().
function sseFetchOnce(events) {
  let call = 0;
  return async (_url, init = {}) => {
    call += 1;
    const enc = new TextEncoder();
    if (call === 1) {
      const stream = new ReadableStream({
        start(controller) {
          for (const e of events) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    // pending stream; aborts when EventStream.close() fires controller.abort()
    const stream = new ReadableStream({
      start(controller) {
        init.signal?.addEventListener("abort", () => { try { controller.error(new Error("aborted")); } catch {} });
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
}

test("EventStream parses SSE frames, dispatches typed + catch-all, advances cursor", async () => {
  const events = [
    { id: 1, type: "request.accepted", request_id: "r1" },
    { id: 2, type: "install.progress", step: "build" },
    { id: 3, type: "request.completed", request_id: "r1" },
  ];
  const c = new OsmodaClient({ token: "osk_e", fetch: sseFetchOnce(events) });
  const stream = c.events("ord1");

  const all = [];
  const completed = [];
  stream.on((e) => all.push(e.type));
  stream.on("request.completed", (e) => completed.push(e.request_id));

  stream.start(); // don't await — it loops/reconnects

  // wait until the 3 events have been dispatched
  const t0 = Date.now();
  while (all.length < 3 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 5));
  stream.close();

  assert.deepEqual(all, ["request.accepted", "install.progress", "request.completed"]);
  assert.deepEqual(completed, ["r1"]);
});
