# Example: Next.js spawn-and-chat

A minimal Next.js (App Router) app that lets a user spawn an osModa server and
chat with it live.

## Architecture

- **Server route `app/api/spawn/route.ts`** — holds the x402 wallet + your
  platform Anthropic key server-side, calls `osmoda.spawn(...)`, and returns
  `{ order_id, token }` to the browser. Never expose the wallet or platform keys
  client-side.
- **Server route `app/api/proxy-chat/route.ts`** (optional) — if you don't want
  the `osk_` token in the browser, proxy the WebSocket through your server.
- **Client `app/page.tsx`** — opens `osmoda.chat(orderId, { token })` and renders
  the streamed `text` / `tool` events.

## Sketch

```ts
// app/api/spawn/route.ts
import { OsmodaClient } from "@osmoda/sdk";
const osmoda = new OsmodaClient({ wallet: serverWallet });

export async function POST() {
  const { order_id, token } = await osmoda.spawnAndWait("starter", {
    runtime: "claude-code",
    credentials: [{ provider: "anthropic", type: "api_key", secret: process.env.ANTHROPIC_KEY! }],
  });
  return Response.json({ order_id, token });
}
```

```tsx
// app/page.tsx (client component)
"use client";
import { OsmodaClient } from "@osmoda/sdk";
import { useState } from "react";

export default function Page() {
  const [out, setOut] = useState("");
  async function go() {
    const { order_id, token } = await fetch("/api/spawn", { method: "POST" }).then((r) => r.json());
    const chat = new OsmodaClient().chat(order_id, { token });
    chat.on("text", (d) => setOut((s) => s + d));
    await chat.send("List the running services.");
  }
  return (<div><button onClick={go}>Spawn + ask</button><pre>{out}</pre></div>);
}
```

## Security notes

- Keep the **x402 wallet** and **platform API keys** server-side only.
- Treat the `osk_` token as scoped to one order; mint per-user, revoke when done
  (`osmoda.tokens.revoke(id)`).
- osModa agents bind services to `127.0.0.1` by default — ask explicitly for
  public exposure (Cloudflare Tunnel / Tailscale) if you need it.
