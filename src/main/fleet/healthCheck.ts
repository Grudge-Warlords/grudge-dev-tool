import { workerHealth } from "../cf/objectStoreWorker";
import { r2Health } from "../cf/r2Direct";
import { aiGatewayHealth } from "../cf/aiGateway";
import { obsHealth } from "../cf/observatory";
import { ollamaHealth } from "../ollama";
import { FLEET_URLS } from "../../shared/fleet";

/**
 * Fleet-wide health check — probes every production Grudge Studio surface
 * in parallel. Uses ONE TRUTH hosts only (no deprecated api.grudge-studio.com).
 */

export type ServiceStatus = "live" | "warn" | "down" | "unknown";

export interface ServiceHealth {
  name: string;
  region: string;
  status: ServiceStatus;
  latencyMs: number;
  error: string | null;
  checkedAt: string;
}

export interface FleetHealthReport {
  ts: string;
  totalMs: number;
  services: ServiceHealth[];
  summary: { live: number; warn: number; down: number; unknown: number; total: number };
}

async function httpProbe(
  url: string,
  opts?: { timeout?: number; headers?: Record<string, string>; acceptStatuses?: number[] },
): Promise<{ ok: boolean; latencyMs: number; status: number | null; error: string | null }> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeout ?? 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: opts?.headers,
    });
    clearTimeout(timer);
    const accept = opts?.acceptStatuses ?? [];
    const ok = res.ok || accept.includes(res.status);
    return {
      ok,
      latencyMs: Date.now() - start,
      status: res.status,
      error: ok ? null : `HTTP ${res.status}`,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const msg = err?.name === "AbortError" ? "Timeout" : (err?.message ?? String(err));
    return { ok: false, latencyMs: Date.now() - start, status: null, error: msg };
  }
}

function toStatus(ok: boolean, latencyMs: number): ServiceStatus {
  if (!ok) return "down";
  if (latencyMs > 3000) return "warn";
  return "live";
}

function buildProbes(): Array<{ name: string; region: string; probe: () => Promise<ServiceHealth> }> {
  const ts = () => new Date().toISOString();

  const probe = (name: string, region: string, url: string, accept?: number[]) => ({
    name,
    region,
    probe: async (): Promise<ServiceHealth> => {
      const r = await httpProbe(url, { acceptStatuses: accept });
      return {
        name,
        region,
        status: toStatus(r.ok, r.latencyMs),
        latencyMs: r.latencyMs,
        error: r.error,
        checkedAt: ts(),
      };
    },
  });

  return [
    // ── Identity + game-data (canonical) ──
    probe("grudge-id", "cloudflare", `${FLEET_URLS.auth}/api/health`),
    probe("grudge-api-railway", "railway", `${FLEET_URLS.gameData}/api/health`),
    probe("fleet-client", "vercel", FLEET_URLS.client),
    probe("objectstore", "cloudflare", `${FLEET_URLS.objectStore}/master-items.json`),
    probe("asset-cdn", "cloudflare", FLEET_URLS.assets),
    probe("legion-ai-hub", "cloudflare", `${FLEET_URLS.ai}/health`),
    probe("forge-editor", "vercel", FLEET_URLS.forge),
    probe("warlord-genesis", "vercel", FLEET_URLS.warlordGenesis),
    probe("warlords-frontend", "vercel", FLEET_URLS.warlords),
    probe("studio-portal", "vercel", FLEET_URLS.identityApi),
    probe("observatory", "cloudflare", `${FLEET_URLS.observatory}/health`),

    // ── ObjectStore worker + R2 (uses keytar when available) ──
    {
      name: "objectstore-worker",
      region: "cloudflare",
      probe: async (): Promise<ServiceHealth> => {
        const r = await workerHealth();
        return {
          name: "objectstore-worker",
          region: "cloudflare",
          status: toStatus(r.ok, r.latencyMs),
          latencyMs: r.latencyMs,
          error: r.error,
          checkedAt: ts(),
        };
      },
    },
    {
      name: "r2-grudge-assets",
      region: "cloudflare",
      probe: async (): Promise<ServiceHealth> => {
        try {
          const r = await r2Health();
          return {
            name: "r2-grudge-assets",
            region: "cloudflare",
            status: toStatus(r.ok, r.latencyMs),
            latencyMs: r.latencyMs,
            error: r.error,
            checkedAt: ts(),
          };
        } catch (err: any) {
          return {
            name: "r2-grudge-assets",
            region: "cloudflare",
            status: "unknown",
            latencyMs: 0,
            error: err?.message ?? "no credentials",
            checkedAt: ts(),
          };
        }
      },
    },
    {
      name: "cf-ai-gateway",
      region: "cloudflare",
      probe: async (): Promise<ServiceHealth> => {
        try {
          const r = await aiGatewayHealth();
          return {
            name: "cf-ai-gateway",
            region: "cloudflare",
            status: toStatus(r.ok, r.latencyMs),
            latencyMs: r.latencyMs,
            error: r.error,
            checkedAt: ts(),
          };
        } catch (err: any) {
          return {
            name: "cf-ai-gateway",
            region: "cloudflare",
            status: "unknown",
            latencyMs: 0,
            error: err?.message ?? "no credentials",
            checkedAt: ts(),
          };
        }
      },
    },
    {
      name: "grudge-observatory-detail",
      region: "cloudflare",
      probe: async (): Promise<ServiceHealth> => {
        const r = await obsHealth();
        return {
          name: "grudge-observatory-detail",
          region: "cloudflare",
          status: toStatus(r.ok, r.latencyMs),
          latencyMs: r.latencyMs,
          error: r.error,
          checkedAt: ts(),
        };
      },
    },

    // ── Local autonomous AI (optional — warn not down when offline) ──
    {
      name: "ollama-local",
      region: "local",
      probe: async (): Promise<ServiceHealth> => {
        const r = await ollamaHealth();
        return {
          name: "ollama-local",
          region: "local",
          status: r.ok ? toStatus(true, r.latencyMs) : "unknown",
          latencyMs: r.latencyMs,
          error: r.ok ? null : r.error ?? "not running (optional)",
          checkedAt: ts(),
        };
      },
    },

    // ── External ──
    {
      name: "solana-rpc",
      region: "external",
      probe: async (): Promise<ServiceHealth> => {
        const r = await httpProbe("https://api.mainnet-beta.solana.com", { timeout: 5000 });
        return {
          name: "solana-rpc",
          region: "external",
          status: r.status === 405 || r.ok ? "live" : "down",
          latencyMs: r.latencyMs,
          error: null,
          checkedAt: ts(),
        };
      },
    },
    probe("puter-platform", "external", "https://puter.com"),
  ];
}

export async function runFleetHealthCheck(): Promise<FleetHealthReport> {
  const start = Date.now();
  const probes = buildProbes();
  const results = await Promise.allSettled(probes.map((p) => p.probe()));

  const services: ServiceHealth[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      name: probes[i].name,
      region: probes[i].region,
      status: "unknown" as ServiceStatus,
      latencyMs: 0,
      error: r.reason?.message ?? "Probe failed",
      checkedAt: new Date().toISOString(),
    };
  });

  const summary = { live: 0, warn: 0, down: 0, unknown: 0, total: services.length };
  services.forEach((s) => summary[s.status]++);

  return {
    ts: new Date().toISOString(),
    totalMs: Date.now() - start,
    services,
    summary,
  };
}

export async function probeService(
  url: string,
): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  return httpProbe(url);
}
