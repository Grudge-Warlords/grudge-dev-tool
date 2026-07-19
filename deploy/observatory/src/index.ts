/**
 * grudge-observatory — Structured logging + AI telemetry for the Grudge fleet.
 * Bindings: OBS_DB (D1), OBS_KV (KV), INGEST_KEYS (secret JSON), ADMIN_KEY (secret)
 */

interface Env {
  OBS_DB: D1Database;
  OBS_KV: KVNamespace;
  INGEST_KEYS: string;     // JSON: { "grudge-ai-hub": "key_...", ... }
  ADMIN_KEY: string;       // Bearer token for query/stats endpoints
  ALLOWED_ORIGINS: string;
}

// ─── CORS ───
function corsHeaders(origin: string, env: Env): HeadersInit {
  const allowed = env.ALLOWED_ORIGINS.split(",").map(s => s.trim());
  const match = allowed.some(p =>
    p.includes("*") ? new RegExp("^" + p.replace(/\*/g, ".*") + "$").test(origin) : p === origin
  );
  return {
    "Access-Control-Allow-Origin": match ? origin : allowed[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-ingest-key, x-source",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, status = 200, origin = "", env?: Env): Response {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (origin && env) Object.assign(headers, corsHeaders(origin, env));
  return new Response(JSON.stringify(data), { status, headers });
}

// ─── Auth ───
function verifyIngestKey(key: string, source: string, env: Env): boolean {
  try {
    const keys = JSON.parse(env.INGEST_KEYS) as Record<string, string>;
    return keys[source] === key || keys["*"] === key;
  } catch { return false; }
}

function verifyAdmin(req: Request, env: Env): boolean {
  const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
  return auth === env.ADMIN_KEY;
}

// ─── Router ───
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = req.headers.get("Origin") ?? "";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin, env) });

    const url = new URL(req.url);
    const path = url.pathname;

    try {
      if (path === "/health")              return json({ ok: true, service: "grudge-observatory", ts: new Date().toISOString() }, 200, origin, env);
      if (path === "/ingest" && req.method === "POST")  return handleIngest(req, env, origin);
      if (path === "/ai"     && req.method === "POST")  return handleAiIngest(req, env, origin);
      if (path === "/query"  && req.method === "GET")   return handleQuery(req, env, url, origin);
      if (path === "/stats"  && req.method === "GET")   return handleStats(req, env, origin);
      if (path === "/ai/stats" && req.method === "GET") return handleAiStats(req, env, url, origin);
      return json({ error: "Not found" }, 404, origin, env);
    } catch (err: any) {
      return json({ error: err.message ?? "Internal error" }, 500, origin, env);
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runRollups(env));
  },
};

// ─── Ingest logs (bulk) ───
async function handleIngest(req: Request, env: Env, origin: string): Promise<Response> {
  const source = req.headers.get("x-source") ?? "unknown";
  const key = req.headers.get("x-ingest-key") ?? "";
  if (!verifyIngestKey(key, source, env)) return json({ error: "Unauthorized" }, 401, origin, env);

  const body = await req.json() as { logs: Array<{ level?: string; message: string; meta?: any; grudge_id?: string; request_id?: string }> };
  if (!body.logs?.length) return json({ error: "No logs" }, 400, origin, env);

  const stmt = env.OBS_DB.prepare(
    "INSERT INTO logs (level, source, message, meta, grudge_id, request_id, cf_ray) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const cfRay = req.headers.get("cf-ray") ?? null;
  const batch = body.logs.slice(0, 100).map(log =>
    stmt.bind(log.level ?? "info", source, log.message, log.meta ? JSON.stringify(log.meta) : null, log.grudge_id ?? null, log.request_id ?? null, cfRay)
  );
  await env.OBS_DB.batch(batch);
  return json({ ok: true, ingested: batch.length }, 200, origin, env);
}

// ─── AI telemetry ingest ───
async function handleAiIngest(req: Request, env: Env, origin: string): Promise<Response> {
  const source = req.headers.get("x-source") ?? "unknown";
  const key = req.headers.get("x-ingest-key") ?? "";
  if (!verifyIngestKey(key, source, env)) return json({ error: "Unauthorized" }, 401, origin, env);

  const body = await req.json() as {
    provider: string; model: string; input_tokens?: number; output_tokens?: number;
    cost_usd?: number; latency_ms?: number; status?: string; grudge_id?: string; meta?: any;
  };

  await env.OBS_DB.prepare(
    "INSERT INTO ai_events (source, provider, model, input_tokens, output_tokens, cost_usd, latency_ms, status, grudge_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(source, body.provider, body.model, body.input_tokens ?? 0, body.output_tokens ?? 0,
    body.cost_usd ?? 0, body.latency_ms ?? 0, body.status ?? "ok", body.grudge_id ?? null,
    body.meta ? JSON.stringify(body.meta) : null
  ).run();

  return json({ ok: true }, 200, origin, env);
}

// ─── Query logs ───
async function handleQuery(req: Request, env: Env, url: URL, origin: string): Promise<Response> {
  if (!verifyAdmin(req, env)) return json({ error: "Unauthorized" }, 401, origin, env);

  const source = url.searchParams.get("source");
  const level = url.searchParams.get("level");
  const since = url.searchParams.get("since");  // ISO timestamp
  const until = url.searchParams.get("until");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 500);

  let sql = "SELECT * FROM logs WHERE 1=1";
  const params: any[] = [];
  if (source) { sql += " AND source = ?"; params.push(source); }
  if (level)  { sql += " AND level = ?"; params.push(level); }
  if (since)  { sql += " AND ts >= ?"; params.push(since); }
  if (until)  { sql += " AND ts <= ?"; params.push(until); }
  sql += " ORDER BY ts DESC LIMIT ?";
  params.push(limit);

  const result = await env.OBS_DB.prepare(sql).bind(...params).all();
  return json({ logs: result.results, count: result.results.length }, 200, origin, env);
}

// ─── Stats (from KV rollups) ───
async function handleStats(req: Request, env: Env, origin: string): Promise<Response> {
  if (!verifyAdmin(req, env)) return json({ error: "Unauthorized" }, 401, origin, env);
  const stats = await env.OBS_KV.get("rollup:latest", "json");
  return json({ stats: stats ?? null, generated: await env.OBS_KV.get("rollup:ts") }, 200, origin, env);
}

// ─── AI usage stats ───
async function handleAiStats(req: Request, env: Env, url: URL, origin: string): Promise<Response> {
  if (!verifyAdmin(req, env)) return json({ error: "Unauthorized" }, 401, origin, env);

  const hours = parseInt(url.searchParams.get("hours") ?? "24");
  const since = new Date(Date.now() - hours * 3600_000).toISOString();

  const byProvider = await env.OBS_DB.prepare(
    `SELECT provider, COUNT(*) as calls, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
     SUM(cost_usd) as total_cost, AVG(latency_ms) as avg_latency, SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors
     FROM ai_events WHERE ts >= ? GROUP BY provider`
  ).bind(since).all();

  const byModel = await env.OBS_DB.prepare(
    `SELECT model, provider, COUNT(*) as calls, SUM(cost_usd) as total_cost, AVG(latency_ms) as avg_latency
     FROM ai_events WHERE ts >= ? GROUP BY model ORDER BY calls DESC LIMIT 20`
  ).bind(since).all();

  return json({ hours, since, by_provider: byProvider.results, by_model: byModel.results }, 200, origin, env);
}

// ─── Cron: hourly rollups ───
async function runRollups(env: Env) {
  const hour = new Date(Date.now() - 3600_000).toISOString();

  const logCounts = await env.OBS_DB.prepare(
    `SELECT source, level, COUNT(*) as count FROM logs WHERE ts >= ? GROUP BY source, level`
  ).bind(hour).all();

  const aiSummary = await env.OBS_DB.prepare(
    `SELECT provider, COUNT(*) as calls, SUM(cost_usd) as cost, AVG(latency_ms) as latency
     FROM ai_events WHERE ts >= ? GROUP BY provider`
  ).bind(hour).all();

  const rollup = {
    period: hour,
    logs: logCounts.results,
    ai: aiSummary.results,
    ts: new Date().toISOString(),
  };

  await env.OBS_KV.put("rollup:latest", JSON.stringify(rollup), { expirationTtl: 86400 });
  await env.OBS_KV.put("rollup:ts", new Date().toISOString());

  // Prune logs older than 7 days
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  await env.OBS_DB.prepare("DELETE FROM logs WHERE ts < ?").bind(cutoff).run();
  await env.OBS_DB.prepare("DELETE FROM ai_events WHERE ts < ?").bind(cutoff).run();
}
