#!/usr/bin/env node
/**
 * Audit Grudge Studio Worker wrangler.toml files against the fleet Workers checklist.
 *
 * Usage:
 *   node scripts/audit-workers-config.mjs
 *   node scripts/audit-workers-config.mjs --json
 *
 * Checklist (docs/ai-workers-d1-r2-stream.md §8):
 *   compatibility_date recent, nodejs_compat, observability, secrets note,
 *   queues/bindings presence, no dual ai.grudge-studio.com claims
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOTS = [
  { id: "legion-api", file: "F:/GitHub/grudge-ai-hub/wrangler.toml", role: "AI path API" },
  { id: "ai-hub", file: "F:/GitHub/grudge-ai-hub/wrangler.domain.toml", role: "Legion AI domain SSOT" },
  { id: "ai-gateway", file: "F:/GitHub/GrudgeBuilder/workers/ai/wrangler.toml", role: "AI gateway (staging / jobs)" },
  { id: "observatory", file: "F:/GitHub/grudge-dev-tool/deploy/observatory/wrangler.toml", role: "Telemetry" },
  { id: "cdn", file: "F:/GitHub/GrudgeBuilder/workers/cdn/wrangler.toml", role: "R2 CDN" },
  { id: "id-gateway", file: "F:/GitHub/GrudgeBuilder/workers/id-gateway/wrangler.toml", role: "Grudge ID edge" },
  { id: "wallet", file: "F:/GitHub/GrudgeBuilder/workers/wallet-site/wrangler.toml", role: "Wallet edge" },
  { id: "objectstore", file: "F:/GitHub/ObjectStore/wrangler.toml", role: "ObjectStore API" },
  { id: "auth-legacy", file: "F:/GitHub/grudge-auth-worker/wrangler.toml", role: "Legacy auth (prefer id.*)" },
];

const MIN_DATE = "2025-09-01";

function parseTomlLite(text) {
  const out = {
    name: null,
    compatibility_date: null,
    nodejs_compat: false,
    observability: false,
    hasAi: false,
    hasQueue: false,
    hasServiceBinding: false,
    hasD1: false,
    hasR2: false,
    hasKv: false,
    secretsComment: /secret put|Secrets/i.test(text),
    routes: [],
    raw: text,
  };
  const nameM = text.match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (nameM) out.name = nameM[1];
  const dateM = text.match(/compatibility_date\s*=\s*"([^"]+)"/);
  if (dateM) out.compatibility_date = dateM[1];
  out.nodejs_compat = /nodejs_compat/.test(text);
  out.observability = /\[observability\][\s\S]*?enabled\s*=\s*true/.test(text);
  out.hasAi = /\[ai\]/.test(text) || /binding\s*=\s*"AI"/.test(text);
  out.hasQueue = /\[\[queues\./.test(text);
  out.hasServiceBinding = /\[\[services\]\]|service\s*=/.test(text);
  out.hasD1 = /\[\[d1_databases\]\]/.test(text);
  out.hasR2 = /\[\[r2_buckets\]\]/.test(text);
  out.hasKv = /\[\[kv_namespaces\]\]/.test(text);
  // Ignore commented lines when collecting route claims
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/pattern\s*=\s*"([^"]+)"/);
    if (m) out.routes.push(m[1]);
  }
  return out;
}

function dateOk(d) {
  if (!d) return false;
  return d >= MIN_DATE;
}

function score(p) {
  const checks = {
    fileExists: existsSync(p.file),
    compatibility_date: false,
    nodejs_compat: false,
    observability: false,
    secretsDocumented: false,
  };
  if (!checks.fileExists) {
    return { ...checks, parsed: null, pass: 0, total: 4, pct: 0 };
  }
  const parsed = parseTomlLite(readFileSync(p.file, "utf8"));
  checks.compatibility_date = dateOk(parsed.compatibility_date);
  checks.nodejs_compat = parsed.nodejs_compat;
  checks.observability = parsed.observability;
  checks.secretsDocumented = parsed.secretsComment;
  const vals = Object.values(checks).filter((v) => typeof v === "boolean");
  // fileExists + 4 checklist items that are config-verifiable
  const core = [
    checks.fileExists,
    checks.compatibility_date,
    checks.nodejs_compat,
    checks.observability,
    checks.secretsDocumented,
  ];
  const pass = core.filter(Boolean).length;
  return { checks, parsed, pass, total: core.length, pct: Math.round((pass / core.length) * 100) };
}

const json = process.argv.includes("--json");
const rows = ROOTS.map((r) => ({ ...r, ...score(r) }));

if (json) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

console.log("Grudge Workers config audit (checklist §8)\n");
console.log(
  "id".padEnd(14) +
    "pct".padEnd(6) +
    "date".padEnd(14) +
    "node".padEnd(6) +
    "obs".padEnd(6) +
    "secrets".padEnd(8) +
    "name",
);
console.log("-".repeat(80));

let worst = 100;
for (const r of rows) {
  if (!r.checks.fileExists) {
    console.log(`${r.id.padEnd(14)}MISS  ${r.file}`);
    worst = 0;
    continue;
  }
  const d = r.parsed.compatibility_date || "—";
  const line =
    r.id.padEnd(14) +
    String(r.pct + "%").padEnd(6) +
    d.padEnd(14) +
    (r.checks.nodejs_compat ? "yes" : "NO").padEnd(6) +
    (r.checks.observability ? "yes" : "NO").padEnd(6) +
    (r.checks.secretsDocumented ? "yes" : "hint").padEnd(8) +
    (r.parsed.name || "");
  console.log(line);
  if (r.pct < worst) worst = r.pct;
}

const aiRoutes = rows.flatMap((r) =>
  (r.parsed?.routes || [])
    .filter((p) => p.includes("ai.grudge-studio.com"))
    .map((p) => ({ id: r.id, pattern: p })),
);
console.log("\nai.grudge-studio.com route claims:");
if (!aiRoutes.length) console.log("  (none declared — OK if routes live in CF dashboard only)");
else aiRoutes.forEach((a) => console.log(`  ${a.id}: ${a.pattern}`));

console.log(`\nWorst score: ${worst}%  (target 100% on config columns)`);
console.log("Code columns (no module state / waitUntil / stream) need source review — see docs.");
process.exit(worst < 80 ? 1 : 0);
