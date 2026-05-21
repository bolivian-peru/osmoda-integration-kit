# Chat & event streaming

## Chat (WebSocket)

```ts
const chat = osmoda.chat(order_id, { token });

chat.on("open", () => console.log("connected"));
chat.on("text", (delta) => process.stdout.write(delta));      // incremental reply
chat.on("tool", ({ name, target }) => console.log(name, target)); // what the agent is doing
chat.on("tool_result", ({ outcome }) => {});
chat.on("done", () => console.log("turn complete"));
chat.on("error", ({ text, code }) => console.error(code, text));
chat.on("backpressure", (paused) => {});                      // server buffer pressure
chat.on("reconnecting", ({ attempt }) => {});
chat.on("close", ({ code, reason }) => {});

await chat.send("Build and deploy a landing page.");
chat.abort();    // stop the current turn
chat.close();    // end the session (no reconnect)

// one-shot request/response:
const reply = await chat.ask("What's the disk usage?");
```

**Protocol facts:** 30 s server heartbeat; idle close after 10 min (code `4003`);
**max 3 concurrent sessions per token**; client frames are `{type:"chat",text}`
and `{type:"abort"}`. `ChatSession` auto-reconnects with exponential backoff on
unexpected drops (not on an explicit `close()`).

## Server events (SSE)

```ts
const stream = osmoda.events(order_id, { token, filter: "request,state,agent,install" });
stream.on("install.progress", (e) => console.log(e));
stream.on("request.completed", (e) => console.log("done", e.request_id));
stream.on((e) => {});            // catch-all
stream.start();                  // cursor-resumable; resumes after transient drops
// stream.close();
```

Event types: `request.accepted` · `request.progress` · `request.completed` ·
`request.failed` · `state.changed` · `agent.wedged` · `agent.healed` ·
`heartbeat.received` · `install.progress`.

## When to use which

- **Chat WS** — you're driving a conversation and want the reply stream.
- **Events SSE** — you're observing lifecycle (provisioning progress, async
  request receipts, wedge/heal) without holding a chat session open.
