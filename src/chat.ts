/**
 * ChatSession — live WebSocket chat with a spawned agent.
 *
 * Wire protocol (server: spawn.os.moda):
 *   client → { type: "chat", text }   |   { type: "abort" }
 *   server → { type: "status" | "text" | "tool_use" | "tool_result" | "done" |
 *              "error" | "backpressure_pause" | "backpressure_resume", ... }
 *
 * The server sends a 30 s heartbeat and closes idle sockets after 10 min with
 * close code 4003. Max 3 concurrent sessions per token. This client:
 *   - authenticates via `?token=osk_...`
 *   - emits typed events you subscribe to with .on()
 *   - auto-reconnects with backoff on unexpected drops (not on explicit close)
 */

import type { ChatEvent } from "./types.js";

type Handler<T> = (arg: T) => void;

interface ChatEventMap {
  open: void;
  status: { agent_connected?: boolean };
  text: string; // incremental delta
  tool: { name: string; target?: string };
  tool_result: { outcome?: string };
  done: void;
  error: { text: string; code?: string };
  backpressure: boolean; // true = paused, false = resumed
  reconnecting: { attempt: number };
  close: { code: number; reason: string };
}

function resolveWebSocket(): typeof WebSocket {
  const g = globalThis as any;
  if (g.WebSocket) return g.WebSocket;
  try {
    // Node < 22 fallback.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("ws");
  } catch {
    throw new Error("No WebSocket implementation. On Node < 22, `npm install ws`.");
  }
}

export interface ChatSessionOptions {
  baseUrl: string;
  orderId: string;
  token: string;
  /** Reconnect automatically on unexpected drops. Default true. */
  autoReconnect?: boolean;
  /** Max reconnect attempts before giving up. Default 5. */
  maxReconnects?: number;
}

export class ChatSession {
  private ws: WebSocket | null = null;
  private readonly opts: Required<ChatSessionOptions>;
  private handlers: { [K in keyof ChatEventMap]?: Handler<ChatEventMap[K]>[] } = {};
  private closedByUser = false;
  private reconnects = 0;

  constructor(opts: ChatSessionOptions) {
    this.opts = {
      autoReconnect: true,
      maxReconnects: 5,
      ...opts,
    };
  }

  on<K extends keyof ChatEventMap>(event: K, cb: Handler<ChatEventMap[K]>): this {
    const list = (this.handlers[event] ||= []) as Handler<ChatEventMap[K]>[];
    list.push(cb);
    return this;
  }

  private emit<K extends keyof ChatEventMap>(event: K, arg: ChatEventMap[K]): void {
    for (const cb of this.handlers[event] || []) cb(arg);
  }

  /** Open the socket. Returns a promise that resolves when connected. */
  connect(): Promise<void> {
    const WS = resolveWebSocket();
    const url =
      this.opts.baseUrl.replace(/^http/, "ws") +
      `/api/v1/chat/${encodeURIComponent(this.opts.orderId)}?token=${encodeURIComponent(this.opts.token)}`;
    return new Promise((resolve, reject) => {
      const ws = new WS(url);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.reconnects = 0;
        this.emit("open", undefined);
        resolve();
      };
      ws.onmessage = (ev: MessageEvent) => this.handleFrame(ev.data);
      ws.onerror = () => {
        if (!opened) reject(new Error("chat websocket failed to connect"));
      };
      ws.onclose = (ev: CloseEvent) => {
        this.emit("close", { code: ev.code, reason: ev.reason });
        if (!this.closedByUser && this.opts.autoReconnect && this.reconnects < this.opts.maxReconnects) {
          this.reconnects += 1;
          const delay = Math.min(1000 * 2 ** (this.reconnects - 1), 15000);
          this.emit("reconnecting", { attempt: this.reconnects });
          setTimeout(() => this.connect().catch(() => {}), delay);
        }
      };
    });
  }

  private handleFrame(raw: unknown): void {
    let msg: ChatEvent;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }
    switch (msg.type) {
      case "status": this.emit("status", { agent_connected: msg.agent_connected }); break;
      case "text": this.emit("text", msg.text); break;
      case "tool_use": this.emit("tool", { name: msg.name, target: msg.target }); break;
      case "tool_result": this.emit("tool_result", { outcome: msg.outcome }); break;
      case "done": this.emit("done", undefined); break;
      case "error": this.emit("error", { text: msg.text, code: msg.code }); break;
      case "backpressure_pause": this.emit("backpressure", true); break;
      case "backpressure_resume": this.emit("backpressure", false); break;
    }
  }

  /** Send a user message. Auto-connects if not open yet. */
  async send(text: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) await this.connect();
    this.ws!.send(JSON.stringify({ type: "chat", text }));
  }

  /** Ask the agent to stop the current turn. */
  abort(): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: "abort" }));
  }

  /** Close the session (no reconnect). */
  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  /** Convenience: send and resolve with the full reply text once `done` fires. */
  ask(text: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let acc = "";
      const onText = (d: string) => { acc += d; };
      const onDone = () => { cleanup(); resolve(acc); };
      const onErr = (e: { text: string }) => { cleanup(); reject(new Error(e.text)); };
      const cleanup = () => {
        this.handlers.text = (this.handlers.text || []).filter((h) => h !== onText);
        this.handlers.done = (this.handlers.done || []).filter((h) => h !== onDone);
        this.handlers.error = (this.handlers.error || []).filter((h) => h !== onErr);
      };
      this.on("text", onText).on("done", onDone).on("error", onErr);
      this.send(text).catch(reject);
    });
  }
}
