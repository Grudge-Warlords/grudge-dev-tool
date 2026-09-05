import { loadConfig, saveConfig, resolveApiBase } from "../lib/config.js";
import { runTruthAudit, FLEET_URLS } from "../lib/fleet.js";
import { loadAuth } from "../lib/auth.js";
import fs from "node:fs";

export async function runDoctor(opts: {
  apiBase?: string;
  json?: boolean;
  write?: boolean;
}): Promise<number> {
  const apiBase = resolveApiBase(opts.apiBase);
  const cfg = loadConfig();
  const auth = await loadAuth();
  const audit = await runTruthAudit(apiBase);

  if (cfg && opts.write !== false) {
    cfg.lastDoctorScore = audit.score;
    saveConfig(cfg);
  }

  const repo = cfg?.repos?.grudgeDevTool ?? cfg?.repos?.grudgeBuilder;
  const checks = [
    {
      id: "config",
      ok: !!cfg && !!repo && fs.existsSync(repo),
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
      detail: `${audit.score}% critical probes`,
    },
  ];

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          apiBase,
          checks,
          score: audit.score,
          criticalScore: audit.criticalScore,
          probes: audit.probes,
          optional: audit.optional,
          mutations: { configScorePersisted: !!cfg && opts.write !== false },
        },
        null,
        2,
      ),
    );
    return checks.every((c) => c.ok) && audit.score >= 85 ? 0 : 1;
  }

  console.log(`\nGrudge Dev Tool doctor — ${apiBase}\n`);
  for (const c of checks) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.id}: ${c.detail}`);
  }
  console.log("\n  ONE TRUTH probes (scored):\n");
  for (const p of audit.probes.filter((x) => !x.optional)) {
    console.log(
      `    ${p.ok ? "✓" : "✗"} ${p.label.padEnd(28)} ${p.status ?? "ERR"}  ${p.detail ?? ""}`,
    );
  }
  if (audit.optional?.length) {
    console.log("\n  Optional / legacy (not scored):\n");
    for (const p of audit.optional) {
      console.log(
        `    ${p.ok ? "✓" : "·"} ${p.label.padEnd(28)} ${p.status ?? "ERR"}  ${p.detail ?? ""}`,
      );
    }
  }
  console.log(`\n  Score: ${audit.score}% (critical only)`);
  console.log(`  Fleet: ${FLEET_URLS.client}\n`);
  return checks.every((c) => c.ok) && audit.score >= 85 ? 0 : 1;
}

function configOk(cfg: { repos: { grudgeBuilder?: string; grudgeDevTool?: string } }): string {
  const repo = cfg.repos?.grudgeDevTool ?? cfg.repos?.grudgeBuilder;
  if (!repo) return "no local project linked — run grudge-dev setup";
  return fs.existsSync(repo) ? repo : `repo missing: ${repo}`;
}
