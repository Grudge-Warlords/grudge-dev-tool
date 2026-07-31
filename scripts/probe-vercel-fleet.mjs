#!/usr/bin/env node
/**
 * Probe canonical fleet + known-bad hosts.
 * Exit 1 if any P0 host is not OK (2xx/3xx).
 *
 * Usage: node scripts/probe-vercel-fleet.mjs
 *        node scripts/probe-vercel-fleet.mjs --json
 *        npm run fleet:probe:vercel
 */

const JSON_OUT = process.argv.includes("--json");

/** P0 — must be green for studio ops (keep in sync with src/shared/fleet.ts) */
const P0 = [
  ["client", "https://client.grudge-studio.com"],
  ["auth", "https://id.grudge-studio.com"],
  ["assets", "https://assets.grudge-studio.com"],
  ["objectStore", "https://objectstore.grudge-studio.com"],
  ["forge", "https://forge.grudge-studio.com"],
  ["coder", "https://coder.grudge-studio.com"],
  ["open", "https://open.grudge-studio.com"],
  ["water", "https://water.grudge-studio.com"],
  ["ai", "https://ai.grudge-studio.com"],
  ["grokBuilder", "https://grok-builder.vercel.app"],
  ["pipeline", "https://grudge-pipeline.vercel.app"],
  ["warlords", "https://grudgewarlords.com"],
  ["characterFoundry", "https://character.grudge-studio.com"],
  ["grudox", "https://grudox.grudge-studio.com"],
  ["arena", "https://arena.grudge-studio.com"],
  ["armada", "https://armada.grudge-studio.com"],
];

/** Known anti-patterns — report only */
const DEAD_WATCH = [
  ["grudgedot (expect 404)", "https://grudgedot.vercel.app"],
  ["builder DNS (expect down until CNAME)", "https://builder.grudge-studio.com"],
  ["dash wrong TLD", "https://dash.grudge.studio"],
  ["carrier", "https://carrier.grudge-studio.com"],
  ["obs", "https://obs.grudge-studio.com"],
  ["tactical-infinity orphan", "https://tactical-infinity.vercel.app"],
];

async function probe(url) {
  const u = url.endsWith("/") || url.includes("?") ? url : url + "/";
  const t0 = Date.now();
  try {
    let res = await fetch(u, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(u, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
    }
    return {
      url: u,
      status: res.status,
      ok: res.status >= 200 && res.status < 400,
      ms: Date.now() - t0,
    };
  } catch (e) {
    try {
      const res = await fetch(u, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      return {
        url: u,
        status: res.status,
        ok: res.status >= 200 && res.status < 400,
        ms: Date.now() - t0,
      };
    } catch (e2) {
      return {
        url: u,
        status: null,
        ok: false,
        ms: Date.now() - t0,
        error: e2 instanceof Error ? e2.message : String(e2),
      };
    }
  }
}

const p0Results = [];
for (const [id, url] of P0) {
  p0Results.push({ id, ...(await probe(url)) });
}

const deadResults = [];
for (const [id, url] of DEAD_WATCH) {
  deadResults.push({ id, ...(await probe(url)) });
}

const p0Fail = p0Results.filter((r) => !r.ok);

if (JSON_OUT) {
  console.log(JSON.stringify({ p0: p0Results, deadWatch: deadResults, p0Fail }, null, 2));
} else {
  console.log("P0 fleet hosts:");
  for (const r of p0Results) {
    const mark = r.ok ? "OK " : "BAD";
    console.log(
      `  ${mark}  ${String(r.status ?? "ERR").padEnd(4)} ${r.id.padEnd(18)} ${r.url} (${r.ms}ms)`,
    );
  }
  console.log("\nDead / anti-pattern watch:");
  for (const r of deadResults) {
    console.log(
      `  ${r.ok ? "LIVE" : "down"} ${String(r.status ?? "ERR").padEnd(4)} ${r.id} — ${r.url}`,
    );
  }
  if (p0Fail.length) {
    console.error(`\n${p0Fail.length} P0 host(s) failed.`);
  } else {
    console.log("\nAll P0 hosts OK.");
  }
}

process.exit(p0Fail.length ? 1 : 0);
