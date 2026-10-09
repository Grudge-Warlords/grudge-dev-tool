#!/usr/bin/env node
/**
 * Growth cadence smoke — free AI join + Legion + Spawn doors.
 * Complements fleet-probe.mjs (ONE TRUTH core). Exit 0 when critical pass ≥ threshold.
 *
 * Usage: node scripts/growth-check.mjs
 *        npm run growth:check
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let cadence = null;
try {
  cadence = JSON.parse(readFileSync(join(ROOT, "config/growth-cadence.json"), "utf8"));
} catch {
  /* optional */
}

const CRITICAL = [
  {
    id: "legion-health",
    url: "https://ai.grudge-studio.com/v1/health",
    critical: true,
    expectJson: true,
    okWhen: (res, body) => res.ok && (body?.ok === true || body?.status === "ok" || typeof body?.version === "string"),
  },
  {
    id: "legion-ssot",
    url: "https://ai.grudge-studio.com/v1/ssot",
    critical: true,
    expectJson: true,
    okWhen: (res, body) => res.ok && body?.ok === true && !!body?.ai,
  },
  {
    id: "forge-free-ai",
    url: "https://forge.grudge-studio.com/api/free-ai/status",
    critical: true,
    expectJson: true,
    okWhen: (res, body) =>
      res.ok && (body?.legionBinding === true || body?.ok === true || body?.guestLegionKey === true),
  },
  {
    id: "spawn-llms",
    url: "https://www.spawn.co/llms.txt",
    critical: true,
    expectJson: false,
    okWhen: (res, _b, text) => res.ok && typeof text === "string" && text.toLowerCase().includes("spawn"),
  },
  {
    id: "spawn-openapi",
    url: "https://www.spawn.co/openapi.json",
    critical: false,
    expectJson: true,
    okWhen: (res, body) => res.ok && !!(body?.openapi || body?.paths),
  },
  {
    id: "hermes-health",
    url: "https://hermes-agent.0umigil.cserverhost.cloud/api/health",
    critical: false,
    expectJson: true,
    okWhen: (res, body) => res.ok && (body?.ok === true || body?.version != null),
  },
  {
    id: "n8n-healthz",
    url: "https://n8n.0umigil.cserverhost.cloud/healthz",
    critical: false,
    expectJson: false,
    okWhen: (res) => res.ok || res.status === 200,
  },
  {
    id: "catsot-worker",
    url: "https://grok-builder-agent.grudge.workers.dev/health",
    critical: false,
    expectJson: true,
    okWhen: (res, body) => res.ok && (body?.ok === true || body?.status === "ok" || body?.groq != null),
  },
];

async function probe(p) {
  const t0 = Date.now();
  try {
    const res = await fetch(p.url, {
      headers: p.expectJson ? { Accept: "application/json" } : undefined,
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    const ct = res.headers.get("content-type") || "";
    let body = null;
    let text = "";
    if (p.expectJson && ct.includes("json")) {
      body = await res.json().catch(() => null);
    } else {
      text = await res.text().catch(() => "");
      if (p.expectJson) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
    }
    const ok = p.okWhen(res, body, text);
    return {
      id: p.id,
      critical: p.critical,
      ok,
      status: res.status,
      ms: Date.now() - t0,
      detail: summarize(body, text, ct),
    };
  } catch (e) {
    return {
      id: p.id,
      critical: p.critical,
      ok: false,
      status: 0,
      ms: Date.now() - t0,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

function summarize(body, text, ct) {
  if (body && typeof body === "object") {
    const bits = [];
    if (body.version != null) bits.push(`v${body.version}`);
    if (body.legionBinding != null) bits.push(`legionBinding=${body.legionBinding}`);
    if (body.guestLegionKey != null) bits.push(`guestKey=${body.guestLegionKey}`);
    if (body.growth?.id) bits.push(`growth=${body.growth.id}`);
    if (bits.length) return bits.join(" ");
    return ct.split(";")[0] || "json";
  }
  if (text) return text.slice(0, 48).replace(/\s+/g, " ");
  return ct.split(";")[0] || "";
}

const results = await Promise.all(CRITICAL.map(probe));
const critical = results.filter((r) => r.critical);
const critPass = critical.filter((r) => r.ok).length;
const allPass = results.filter((r) => r.ok).length;
const critScore = Math.round((critPass / Math.max(1, critical.length)) * 100);

console.log("Grudge growth check — free AI · Legion · Spawn");
if (cadence?.updated) console.log(`Cadence SSOT updated: ${cadence.updated} (${cadence.id})`);
console.log("");
for (const r of results) {
  const tag = r.critical ? "CRIT" : "info";
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  [${tag}] ${r.id.padEnd(18)} ${String(r.status).padStart(3)}  ${String(r.ms).padStart(5)}ms  ${r.detail}`,
  );
}
console.log("");
console.log(`Critical: ${critScore}% (${critPass}/${critical.length}) · All: ${allPass}/${results.length}`);
console.log("Next: docs/ai-spawn-growth-cadence.md · Agent AI → Growth check");
console.log("Daily improve: one player-facing fix. Weekly: one Spawn/world push.");

if (critScore < 75) {
  process.exitCode = 1;
}
