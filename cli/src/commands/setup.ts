import {
  autonomousSetup,
  configPath,
  loadConfig,
  saveConfig,
} from "../lib/config.js";
import { runTruthAudit } from "../lib/fleet.js";

export async function runSetup(opts: {
  apiBase?: string;
  repo?: string;
  json?: boolean;
}): Promise<number> {
  const cfg = await autonomousSetup({
    apiBase: opts.apiBase,
    repo: opts.repo,
  });
  const audit = await runTruthAudit(cfg.apiBase);
  cfg.lastDoctorScore = audit.score;
  saveConfig(cfg);

  if (opts.json) {
    console.log(JSON.stringify({ config: cfg, audit }, null, 2));
    return audit.score >= 85 ? 0 : 1;
  }

  console.log("\nGrudge Dev Tool — setup complete\n");
  console.log(`  Config:  ${configPath()}`);
  console.log(`  API:     ${cfg.apiBase}`);
  console.log(`  Repo:    ${cfg.repos.grudgeBuilder ?? "(not found)"}`);
  console.log(`  Truth:   ${audit.score}%`);
  for (const p of audit.probes) {
    const mark = p.ok ? "✓" : "✗";
    console.log(`    ${mark} ${p.label} (${p.status ?? "ERR"})`);
  }
  if (audit.score < 85) {
    console.log("\n  Tip: run `grudge-dev login` then `grudge-dev doctor` again.\n");
    return 1;
  }
  console.log("\n  Next: grudge-dev login --admin-password <pw>\n");
  return 0;
}

export function ensureConfig(): void {
  if (!loadConfig()) {
    console.error("No config — run: grudge-dev setup");
    process.exit(1);
  }
}