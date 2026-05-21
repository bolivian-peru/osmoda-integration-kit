import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OsmodaClient } from "../dist/index.js";

// Minimal mock WebSocket installed on globalThis so ChatSession picks it up.
let lastSocket = null;
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.sent = [];
    lastSocket = this;
    queueMicrotask(() => { this.readyState = 1; this.onopen && this.onopen(); });
  }
  send(data) { this.sent.push(data); }
  close(code = 1000, reason = "") { this.readyState = 3; this.onclose && this.onclose({ code, reason }); }
  // helper for tests
  push(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
}

beforeEach(() => { globalThis.WebSocket = MockWebSocket; lastSocket = null; });

test("chat frames map to typed events; URL carries token", async () => {
  const c = new OsmodaClient({ baseUrl: "https://spawn.os.moda" });
  const chat = c.chat("ord1", { token: "osk_z" });
  const got = { text: "", tools: [], done: false };
  chat.on("text", (d) => (got.text += d));
  chat.on("tool", (t) => got.tools.push(t));
  chat.on("done", () => (got.done = true));
  await chat.connect();

  assert.match(lastSocket.url, /^wss:\/\/spawn\.os\.moda\/api\/v1\/chat\/ord1\?token=osk_z$/);

  lastSocket.push({ type: "text", text: "Hel" });
  lastSocket.push({ type: "tool_use", name: "Bash", target: "ls /" });
  lastSocket.push({ type: "text", text: "lo" });
  lastSocket.push({ type: "done" });

  assert.equal(got.text, "Hello");
  assert.deepEqual(got.tools, [{ name: "Bash", target: "ls /" }]);
  assert.equal(got.done, true);
});

test("send() transmits a chat frame", async () => {
  const c = new OsmodaClient();
  const chat = c.chat("ord1", { token: "osk_z" });
  await chat.connect();
  await chat.send("hi there");
  assert.deepEqual(JSON.parse(lastSocket.sent[0]), { type: "chat", text: "hi there" });
});

test("ask() resolves with accumulated text on done", async () => {
  const c = new OsmodaClient();
  const chat = c.chat("ord1", { token: "osk_z" });
  await chat.connect();
  const p = chat.ask("question?");
  // server streams a reply then completes
  queueMicrotask(() => {
    lastSocket.push({ type: "text", text: "the " });
    lastSocket.push({ type: "text", text: "answer" });
    lastSocket.push({ type: "done" });
  });
  assert.equal(await p, "the answer");
});

test("error frame surfaces via ask() rejection", async () => {
  const c = new OsmodaClient();
  const chat = c.chat("ord1", { token: "osk_z" });
  await chat.connect();
  const p = chat.ask("x");
  queueMicrotask(() => lastSocket.push({ type: "error", text: "boom", code: "agent_error" }));
  await assert.rejects(p, (e) => /boom/.test(e.message));
});
