-- grudge-observatory D1 schema
-- Run: npx wrangler d1 execute OBS_DB --file=schema.sql

CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  level      TEXT    NOT NULL DEFAULT 'info',  -- trace|debug|info|warn|error|fatal
  source     TEXT    NOT NULL,                 -- worker name: grudge-ai-hub, grudge-auth-gateway, etc.
  message    TEXT    NOT NULL,
  meta       TEXT,                             -- JSON blob for structured context
  grudge_id  TEXT,                             -- optional user context
  request_id TEXT,                             -- trace correlation
  cf_ray     TEXT                              -- Cloudflare Ray ID
);

CREATE INDEX IF NOT EXISTS idx_logs_ts     ON logs(ts);
CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source);
CREATE INDEX IF NOT EXISTS idx_logs_level  ON logs(level);

CREATE TABLE IF NOT EXISTS ai_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source        TEXT    NOT NULL,
  provider      TEXT    NOT NULL,  -- anthropic, openai, workers-ai, puter
  model         TEXT    NOT NULL,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd      REAL    DEFAULT 0,
  latency_ms    INTEGER DEFAULT 0,
  status        TEXT    DEFAULT 'ok',  -- ok|error|timeout|rate_limited
  grudge_id     TEXT,
  meta          TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_ts       ON ai_events(ts);
CREATE INDEX IF NOT EXISTS idx_ai_source   ON ai_events(source);
CREATE INDEX IF NOT EXISTS idx_ai_provider ON ai_events(provider);

CREATE TABLE IF NOT EXISTS health_snapshots (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source   TEXT    NOT NULL,
  status   TEXT    NOT NULL,  -- live|warn|down
  latency  INTEGER DEFAULT 0,
  meta     TEXT
);

CREATE INDEX IF NOT EXISTS idx_health_ts ON health_snapshots(ts);
