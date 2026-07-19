/**
 * Observatory Client SDK — drop into any Cloudflare Worker.
 *
 * Usage in a CF Worker:
 *   import { Observatory } from "./observatory-client";
 *   const obs = new Observatory({
 *     endpoint: "https://obs.grudge-studio.com",
 *     source: "grudge-ai-hub",
 *     key: env.OBSERVATORY_KEY,
 *     waitUntil: ctx.waitUntil.bind(ctx),
 *   });
 *   obs.info("Request processed", { path: "/chat", status: 200 });
 *   obs.ai({ provider: "anthropic", model: "claude-sonnet-4-6", input_tokens: 500, output_tokens: 200, latency_ms: 1200, cost_usd: 0.003 });
 */

interface ObservatoryConfig {
  endpoint: string;     // https://obs.grudge-studio.com
  source: string;       // worker name
  key: string;          // ingest key from INGEST_KEYS
  waitUntil: (p: Promise<any>) => void;
  batchSize?: number;   // flush after N logs (default: 10)
  flushMs?: number;     // flush after N ms (default: 5000)
}

interface LogEntry {
  level: string;
  message: string;
  meta?: any;
  grudge_id?: string;
  request_id?: string;
}

interface AiEvent {
  provider: string;
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  latency_ms?: number;
  status?: string;
  grudge_id?: string;
  meta?: any;
}

export class Observatory {
  private cfg: Required<ObservatoryConfig>;
  private buffer: LogEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ObservatoryConfig) {
    this.cfg = { batchSize: 10, flushMs: 5000, ...config };
  }

  // ─── Log levels ───
  trace(msg: string, meta?: any, ctx?: { grudge_id?: string; request_id?: string }) { this.log("trace", msg, meta, ctx); }
  debug(msg: string, meta?: any, ctx?: { grudge_id?: string; request_id?: string }) { this.log("debug", msg, meta, ctx); }
  info(msg: string, meta?: any, ctx?: { grudge_id?: string; request_id?: string })  { this.log("info", msg, meta, ctx); }
  warn(msg: string, meta?: any, ctx?: { grudge_id?: string; request_id?: string })  { this.log("warn", msg, meta, ctx); }
  error(msg: string, meta?: any, ctx?: { grudge_id?: string; request_id?: string }) { this.log("error", msg, meta, ctx); }
  fatal(msg: string, meta?: any, ctx?: { grudge_id?: string; request_id?: string }) { this.log("fatal", msg, meta, ctx); }

  private log(level: string, message: string, meta?: any, ctx?: { grudge_id?: string; request_id?: string }) {
    this.buffer.push({ level, message, meta, grudge_id: ctx?.grudge_id, request_id: ctx?.request_id });
    if (this.buffer.length >= this.cfg.batchSize) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.cfg.flushMs);
    }
  }

  // ─── AI telemetry ───
  ai(event: AiEvent): void {
    this.cfg.waitUntil(
      fetch(`${this.cfg.endpoint}/ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-source": this.cfg.source,
          "x-ingest-key": this.cfg.key,
        },
        body: JSON.stringify(event),
      }).catch(() => {}) // fire-and-forget
    );
  }

  // ─── Flush buffered logs ───
  flush(): void {
    if (!this.buffer.length) return;
    const logs = [...this.buffer];
    this.buffer = [];
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }

    this.cfg.waitUntil(
      fetch(`${this.cfg.endpoint}/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-source": this.cfg.source,
          "x-ingest-key": this.cfg.key,
        },
        body: JSON.stringify({ logs }),
      }).catch(() => {})
    );
  }

  // ─── Health check ───
  async health(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.cfg.endpoint}/health`);
      return { ok: res.ok, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }
}
