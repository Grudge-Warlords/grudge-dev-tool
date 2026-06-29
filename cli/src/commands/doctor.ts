import { loadConfig, saveConfig, resolveApiBase } from "../lib/config.js";
import { runTruthAudit, FLEET_URLS } from "../lib/fleet.js";
import { loadAuth } from "../lib/auth.js";
import fs from "node:fs";

export async function runDoctor(opts: {
  apiBase?: string;
  json?: boolean;
}): Promise<number> {
  const apiBase = resolveApiBase(opts.apiBase);
  const cfg = loadConfig();
  const auth = await loadAuth();
  const audit = await runTruthAudit(apiBase);

  if (cfg) {
    cfg.lastDoctorScore = audit.score;
    saveConfig(cfg);
  }

  const checks = [
    {
      id: "config",
      ok: !!cfg,
      detail: cfg ? configOk(cfg) : "missing — run grudge-dev setup",
    },
    {
      id: "auth",
      ok: !!(auth.token || auth.adminPassword),
      detail: auth.token
        ? "JWT token set"
        : auth.adminPassword
          ? "admin password set"
          : "no credentials — run grudge-dev login",
    },
    {
      id: "truth",
      ok: audit.score >= 85,
      detail: `${audit.score}%`,
    },
  ];

  if (opts.json) {
    console.log(JSON.stringify({ apiBase, checks, probes: audit.probes }, null, 2));
    return checks.every((c) => c.ok) && audit.score >= 85 ? 0 : 1;
  }

  console.log(`\nGrudge Dev Tool doctor — ${apiBase}\n`);
  for (const c of checks) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.id}: ${c.detail}`);
  }
  console.log("\n  ONE TRUTH probes:\n");
  for (const p of audit.probes) {
    console.log(
      `    ${p.ok ? "✓" : "✗"} ${p.label.padEnd(22)} ${p.status ?? "ERR"}  ${p.detail ?? ""}`,
    );
  }
  console.log(`\n  Score: ${audit.score}%`);
  console.log(`  Fleet: ${FLEET_URLS.client}\n`);
  return audit.score >= 85 ? 0 : 1;
}

function configOk(cfg: { repos: { grudgeBuilder?: string } }): string {
  const repo = cfg.repos.grudgeBuilder;
  if (!repo) return "no grudge-builder repo linked";
  return fs.existsSync(repo) ? repo : `repo missing: ${repo}`;
}