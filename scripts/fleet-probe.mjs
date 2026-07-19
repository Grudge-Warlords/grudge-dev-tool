#!/usr/bin/env node
/**
 * Production fleet probe — no Electron required.
 * Exit 0 when score ≥ 70% (core hosts live). Exit 1 on hard failures.
 *
 * Usage: node scripts/fleet-probe.mjs
 *        GRUDGE_API_BASE=https://client.grudge-studio.com node scripts/fleet-probe.mjs
 */

const CLIENT = (process.env.GRUDGE_API_BASE || "https://client.grudge-studio.com").replace(
  /\/$/,
  "",
);
const AUTH = "https://id.grudge-studio.com";
const RAILWAY = "https://grudge-api-production-0d46.up.railway.app";
const OBJECTSTORE = "https://objectstore.grudge-studio.com/api/v1";
const ASSETS = "https://assets.grudge-studio.com";
const AI = "https://ai.grudge-studio.com";
const FORGE = "https://forge.grudge-studio.com";
const WARLORDS = "https://grudgewarlords.com";
const GENESIS = "https://warlord-genesis.vercel.app";
const DOCS = "https://grudge-warlords.github.io/grudge-dev-tool/";

const PROBES = [
  { id: "id-health", url: `${AUTH}/api/health`, expectJson: true },
  { id: "railway-health", url: `${RAILWAY}/api/health`, expectJson: true },
  { id: "client", url: CLIENT, expectJson: false },
  { id: "objectstore-items", url: `${OBJECTSTORE}/master-items.json`, expectJson: true },
  { id: "assets-cdn", url: ASSETS, expectJson: false },
  { id: "ai-hub", url: `${AI}/health`, expectJson: false },
  { id: "forge", url: FORGE, expectJson: false },
  { id: "warlords", url: WARLORDS, expectJson: false },
  { id: "warlord-genesis", url: GENESIS, expectJson: false },
  { id: "dev-tool-docs", url: DOCS, expectJson: false },
];

async function probe({ id, url, expectJson }) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: expectJson ? { Accept: "application/json" } : undefined,
      signal: AbortSignal.timeout(12000),
    });
    const ct = res.headers.get("content-type") || "";
    const htmlLeak = expectJson && ct.includes("text/html");
    const ok = res.ok && !htmlLeak;
    return {
      id,
      ok,
      status: res.status,
      ms: Date.now() - t0,
      detail: htmlLeak ? "HTML leak" : ct.split(";")[0] || "",
    };
  } catch (e) {
    return {
      id,
      ok: false,
      status: 0,
      ms: Date.now() - t0,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

const results = await Promise.all(PROBES.map(probe));
const pass = results.filter((r) => r.ok).length;
const score = Math.round((pass / results.length) * 100);

console.log("Grudge Studio fleet probe");
console.log(`API base: ${CLIENT}`);
console.log("");
for (const r of results) {
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(22)} ${String(r.status).padStart(3)}  ${String(r.ms).padStart(5)}ms  ${r.detail}`,
  );
}
console.log("");
console.log(`Score: ${score}% (${pass}/${results.length})`);

if (score < 70) {
  console.error("Fleet score below 70% — production wiring needs attention.");
  process.exit(1);
}
console.log("Fleet core healthy.");
process.exit(0);
