/**
 * EventStream — the per-server unified event plane (Server-Sent Events).
 *
 *   GET /api/v1/servers/:orderId/events   (Authorization: Bearer osk_…)
 *
 * Cursor-resumable: each event has an `id`; reconnects resume from the last id.
 * Event types include request.accepted/progress/completed/failed,
 * state.changed, agent.wedged/healed, heartbeat.received, install.progress.
 *
 * Implemented with a fetch stream reader (no `eventsource` dependency), which
 * works on Node 18+ and modern browsers.
 */

import type { ServerEvent } from "./types.js";

type Handler = (e: ServerEvent) => void;

export interface EventStreamOptions {
  baseUrl: string;
  orderId: string;
  token: string;
  /** Resume from this event id. */
  cursor?: number;
  /** Comma-separated filter, e.g. "request,state,agent". */
  filter?: string;
  fetchImpl?: typeof fetch;
}

export class EventStream {
  private readonly opts: EventStreamOptions;
  private handlers: Handler[] = [];
  private typed: Record<string, Handler[]> = {};
  private controller: AbortController | null = null;
  private cursor: number;
  private closed = false;

  constructor(opts: EventStreamOptions) {
    this.opts = opts;
    this.cursor = opts.cursor ?? 0;
  }

  /** Subscribe to all events, or to a specific event type. */
  on(handler: Handler): this;
  on(type: string, handler: Handler): this;
  on(a: string | Handler, b?: Handler): this {
    if (typeof a === "function") this.handlers.push(a);
    else (this.typed[a] ||= []).push(b!);
    return this;
  }

  private emit(e: ServerEvent): void {
    if (typeof e.id === "number") this.cursor = Math.max(this.cursor, e.id);
    for (const h of this.handlers) h(e);
    for (const h of this.typed[e.type] || []) h(e);
  }

  /** Begin streaming. Auto-resumes from the last cursor on transient drops. */
  async start(): Promise<void> {
    const doFetch = this.opts.fetchImpl || fetch;
    while (!this.closed) {
      this.controller = new AbortController();
      const url = new URL(
        `${this.opts.baseUrl}/api/v1/servers/${encodeURIComponent(this.opts.orderId)}/events`,
      );
      url.searchParams.set("cursor", String(this.cursor));
      if (this.opts.filter) url.searchParams.set("filter", this.opts.filter);

      try {
        const res = await doFetch(url.toString(), {
          headers: { Authorization: `Bearer ${this.opts.token}`, Accept: "text/event-stream" },
          signal: this.controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`events stream HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            try { this.emit(JSON.parse(dataLine.slice(5).trim())); } catch { /* skip */ }
          }
        }
      } catch {
        if (this.closed) break;
        await new Promise((r) => setTimeout(r, 2000)); // backoff then resume from cursor
      }
    }
  }

  close(): void {
    this.closed = true;
    this.controller?.abort();
  }
}
