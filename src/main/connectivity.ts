import { BrowserWindow, net } from "electron";
import { getApiBaseUrl, getAssetsApiBaseUrl, resolveBackend } from "./api";
import { readCf } from "./cf/credentials";
import { r2Health } from "./cf/r2Direct";
import { runTruthAudit, TRUTH_HEALTH_THRESHOLD, type TruthProbe } from "../shared/fleet";

export interface ConnectivityState {
  reachable: boolean;
  online: boolean;
  apiBaseUrl: string;
  lastCheckedAt: number;
  latencyMs: number | null;
  status: number | null;
  error: string | null;
  /** ONE TRUTH audit score (0–100) when probing the fleet client. */
  truthScore?: number | null;
  /** Individual probe rows for Settings diagnostics. */
  probes?: TruthProbe[];
}

let timer: NodeJS.Timeout | null = null;
let last: ConnectivityState = {
  reachable: false,
  online: true,
  apiBaseUrl: "",
  lastCheckedAt: 0,
  latencyMs: null,
  status: null,
  error: null,
  truthScore: null,
  probes: [],
};

function probe(url: string, timeoutMs = 4000): Promise<{ ok: boolean; status: number | null; latencyMs: number; error: string | null }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = net.request({ method: "GET", url });
    const t = setTimeout(() => {
      try { req.abort(); } catch { /* ignore */ }
      resolve({ ok: false, status: null, latencyMs: Date.now() - start, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    req.on("response", (res: any) => {
      clearTimeout(t);
      res.on("data", () => { /* ignore */ });
      res.on("end", () => {
        const status = res.statusCode ?? null;
        const ok = !!status && status < 500;
        resolve({ ok, status, latencyMs: Date.now() - start, error: ok ? null : `HTTP ${status}` });
      });
    });
    req.on("error", (err: Error) => {
      clearTimeout(t);
      resolve({ ok: false, status: null, latencyMs: Date.now() - start, error: err.message });
    });
    req.end();
  });
}

async function tick(broadcast: (s: ConnectivityState) => void) {
  try {
    const backend = await resolveBackend();

    if (backend === "r2-direct") {
      const endpoint = (await readCf("endpoint")) ?? "";
      const r = await r2Health();
      last = {
        reachable: r.ok,
        online: net.isOnline(),
        apiBaseUrl: endpoint,
        lastCheckedAt: Date.now(),
        latencyMs: r.latencyMs,
        status: r.ok ? 200 : null,
        error: r.error,
        truthScore: null,
        probes: [],
      };
      broadcast(last);
      return;
    }

    if (backend === "cloudflare-worker") {
      const w = await readCf("workerUrl");
      const apiBase = (w ?? "").replace(/\/$/, "");
      const probeUrl = `${apiBase}/health`;
      const workerProbe = await probe(probeUrl);
      last = {
        reachable: workerProbe.ok,
        online: net.isOnline(),
        apiBaseUrl: apiBase,
        lastCheckedAt: Date.now(),
        latencyMs: workerProbe.latencyMs,
        status: workerProbe.status,
        error: workerProbe.error,
        truthScore: null,
        probes: [],
      };
      broadcast(last);
      return;
    }

    // ONE TRUTH fleet probes + objectstore list smoke test (what Loader/Browser use).
    const apiBase = await getApiBaseUrl();
    const assetsBase = (await getAssetsApiBaseUrl()).replace(/\/$/, "");
    const audit = await runTruthAudit(apiBase);
    const listProbe = await probe(`${assetsBase}/api/objectstore/list?prefix=asset-packs/&limit=1`);
    const failed = audit.probes.filter((p) => !p.ok);
    const avgLatency = audit.probes.length
      ? Math.round(audit.probes.reduce((sum, p) => sum + (p.latencyMs ?? 0), 0) / audit.probes.length)
      : null;
    const truthOk = audit.score >= TRUTH_HEALTH_THRESHOLD;
    const objectstoreOk = listProbe.ok;

    last = {
      reachable: truthOk && objectstoreOk,
      online: net.isOnline(),
      apiBaseUrl: apiBase,
      lastCheckedAt: Date.now(),
      latencyMs: avgLatency,
      status: audit.probes.find((p) => p.id === "fleet-manifest")?.status ?? null,
      error: !truthOk
        ? `ONE TRUTH ${audit.score}% — ${failed.map((p) => p.label).join(", ")}`
        : !objectstoreOk
          ? `objectstore list failed${listProbe.error ? ` — ${listProbe.error}` : ""} (${assetsBase})`
          : null,
      truthScore: audit.score,
      probes: audit.probes,
    };
    broadcast(last);
  } catch (err: any) {
    last = {
      ...last,
      reachable: false,
      online: net.isOnline(),
      error: err?.message ?? String(err),
      lastCheckedAt: Date.now(),
    };
    broadcast(last);
  }
}

export function startConnectivity(getWindows: () => BrowserWindow[], intervalMs = 30000): void {
  if (timer) return;
  const broadcast = (s: ConnectivityState) => {
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send("connectivity:changed", s);
    }
  };
  tick(broadcast);
  timer = setInterval(() => tick(broadcast), intervalMs);
}

export function stopConnectivity(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getConnectivity(): ConnectivityState {
  return last;
}