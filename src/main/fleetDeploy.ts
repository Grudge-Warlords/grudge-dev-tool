/**
 * Fleet platform status + redeploy via local CLIs and vault tokens.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { getSecret, setSecret } from "./auth/secretStore";
import log from "./logger";
import {
  FLEET_DEPLOY_TARGETS,
  FLEET_TOKEN_ACCOUNTS,
  type FleetDeployTarget,
  type FleetTokenKind,
} from "../shared/fleetConnections";

export type TokenStatus = {
  kind: FleetTokenKind;
  account: string;
  stored: boolean;
  chars: number;
};

export type CliWhoami = {
  ok: boolean;
  detail: string;
};

function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: true,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({ code: -1, stdout, stderr: stderr + "\n[timeout]" });
    }, opts.timeoutMs ?? 180_000);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

export async function tokenStatus(): Promise<TokenStatus[]> {
  const kinds = Object.keys(FLEET_TOKEN_ACCOUNTS) as FleetTokenKind[];
  const out: TokenStatus[] = [];
  for (const kind of kinds) {
    const account = FLEET_TOKEN_ACCOUNTS[kind];
    const v = await getSecret(account);
    out.push({
      kind,
      account,
      stored: Boolean(v && v.length),
      chars: v?.length ?? 0,
    });
  }
  return out;
}

export async function saveToken(kind: FleetTokenKind, value: string): Promise<{ ok: true }> {
  const account = FLEET_TOKEN_ACCOUNTS[kind];
  if (kind === "puter") {
    // Puter session is owned by puterSession — allow overwrite of puter-token only.
  }
  await setSecret(account, value.trim());
  log.info(`[fleetDeploy] saved token ${kind} (${value.trim().length} chars)`);
  return { ok: true };
}

export async function clearToken(kind: FleetTokenKind): Promise<{ ok: true }> {
  const { deleteSecret } = await import("./auth/secretStore");
  await deleteSecret(FLEET_TOKEN_ACCOUNTS[kind]);
  return { ok: true };
}

export async function whoami(kind: Exclude<FleetTokenKind, "puter">): Promise<CliWhoami> {
  const token = await getSecret(FLEET_TOKEN_ACCOUNTS[kind]);
  if (kind === "vercel") {
    const env = token ? { VERCEL_TOKEN: token } : {};
    const r = await runCmd("vercel", ["whoami"], { env, timeoutMs: 30_000 });
    const detail = (r.stdout || r.stderr).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" · ");
    return { ok: r.code === 0, detail: detail || `exit ${r.code}` };
  }
  if (kind === "railway") {
    const env = token ? { RAILWAY_TOKEN: token } : {};
    const r = await runCmd("railway", ["whoami"], { env, timeoutMs: 30_000 });
    const detail = (r.stdout || r.stderr).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" · ");
    return { ok: r.code === 0, detail: detail || `exit ${r.code}` };
  }
  // cloudflare — prefer OAuth wrangler config; token optional
  const env = token ? { CLOUDFLARE_API_TOKEN: token } : {};
  const r = await runCmd("wrangler", ["whoami"], { env, timeoutMs: 45_000 });
  const detail = (r.stdout || r.stderr).trim().split(/\r?\n/).filter(Boolean).slice(-5).join(" · ");
  return { ok: r.code === 0 || /logged in/i.test(detail), detail: detail || `exit ${r.code}` };
}

export async function puterStatus(): Promise<CliWhoami> {
  const tok = await getSecret(FLEET_TOKEN_ACCOUNTS.puter);
  if (!tok) return { ok: false, detail: "puter-token missing — sign in via Settings / Grudge ID" };
  return { ok: true, detail: `puter-token stored (${tok.length} chars)` };
}

function findTarget(id: string): FleetDeployTarget {
  const t = FLEET_DEPLOY_TARGETS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown deploy target: ${id}`);
  return t;
}

export async function redeploy(targetId: string): Promise<{
  ok: boolean;
  target: string;
  platform: string;
  detail: string;
  log: string;
}> {
  const t = findTarget(targetId);
  log.info(`[fleetDeploy] redeploy ${t.id} via ${t.platform}`);

  if (t.platform === "vercel") {
    const token = await getSecret(FLEET_TOKEN_ACCOUNTS.vercel);
    const env = token ? { VERCEL_TOKEN: token } : {};
    const cwd = t.cwd && existsSync(t.cwd) ? t.cwd : undefined;
    if (!cwd) {
      // Redeploy latest production URL without local cwd
      const host = t.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const r = await runCmd("vercel", ["redeploy", `https://${host}`, "--yes"], {
        env,
        timeoutMs: 300_000,
      });
      const logText = (r.stdout + "\n" + r.stderr).trim();
      return {
        ok: r.code === 0,
        target: t.id,
        platform: t.platform,
        detail: r.code === 0 ? "vercel redeploy ok" : `vercel exit ${r.code}`,
        log: logText.slice(-4000),
      };
    }
    const r = await runCmd("vercel", ["--prod", "--yes"], { cwd, env, timeoutMs: 600_000 });
    const logText = (r.stdout + "\n" + r.stderr).trim();
    return {
      ok: r.code === 0,
      target: t.id,
      platform: t.platform,
      detail: r.code === 0 ? `vercel --prod (${cwd})` : `vercel exit ${r.code}`,
      log: logText.slice(-4000),
    };
  }

  if (t.platform === "cloudflare") {
    const token = await getSecret(FLEET_TOKEN_ACCOUNTS.cloudflare);
    const env = token ? { CLOUDFLARE_API_TOKEN: token } : {};
    const cwd = t.cwd && existsSync(t.cwd) ? t.cwd : undefined;
    if (!cwd) {
      return {
        ok: false,
        target: t.id,
        platform: t.platform,
        detail: `Missing local cwd for wrangler (${t.cwd || "unset"})`,
        log: "",
      };
    }
    const r = await runCmd("npm", ["run", "deploy"], { cwd, env, timeoutMs: 600_000 });
    // fallback to wrangler deploy if no npm script
    if (r.code !== 0) {
      const r2 = await runCmd("wrangler", ["deploy"], { cwd, env, timeoutMs: 600_000 });
      const logText = (r.stdout + r.stderr + "\n" + r2.stdout + r2.stderr).trim();
      return {
        ok: r2.code === 0,
        target: t.id,
        platform: t.platform,
        detail: r2.code === 0 ? `wrangler deploy (${cwd})` : `wrangler exit ${r2.code}`,
        log: logText.slice(-4000),
      };
    }
    const logText = (r.stdout + "\n" + r.stderr).trim();
    return {
      ok: true,
      target: t.id,
      platform: t.platform,
      detail: `npm run deploy (${cwd})`,
      log: logText.slice(-4000),
    };
  }

  if (t.platform === "railway") {
    const token = await getSecret(FLEET_TOKEN_ACCOUNTS.railway);
    if (!token) {
      return {
        ok: false,
        target: t.id,
        platform: t.platform,
        detail: "RAILWAY_TOKEN / fleet.railwayToken missing — save in Settings",
        log: "",
      };
    }
    const env = { RAILWAY_TOKEN: token };
    // Redeploy via API when no linked cwd — trigger latest deployment restart is project-specific.
    const r = await runCmd("railway", ["status"], { env, timeoutMs: 60_000 });
    const logText = (r.stdout + "\n" + r.stderr).trim();
    return {
      ok: r.code === 0,
      target: t.id,
      platform: t.platform,
      detail:
        r.code === 0
          ? "railway CLI authenticated — link a service cwd or use Railway dashboard for redeploy"
          : `railway exit ${r.code}`,
      log: logText.slice(-4000),
    };
  }

  return {
    ok: false,
    target: t.id,
    platform: t.platform,
    detail: "Puter sites redeploy via puter-space / Coder — not CLI here",
    log: "",
  };
}

export function listTargets(): FleetDeployTarget[] {
  return FLEET_DEPLOY_TARGETS.map((t) => ({
    ...t,
    cwd: t.cwd && existsSync(t.cwd) ? t.cwd : t.cwd,
  }));
}
