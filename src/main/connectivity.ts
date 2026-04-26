import { BrowserWindow, net } from "electron";
import { getApiBaseUrl, getBackendMode } from "./api";
import { readCf } from "./cf/credentials";

export interface ConnectivityState {
  reachable: boolean;
  online: boolean;          // OS-level reachability
  apiBaseUrl: string;
  lastCheckedAt: number;
  latencyMs: number | null;
  status: number | null;
  error: string | null;
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
      // Drain to free socket
      res.on("data", () => { /* ignore */ });
      res.on("end", () => {
        const status = res.statusCode ?? null;
        // 2xx or 4xx (auth-required) both indicate the host is reachable;
        // 5xx and network errors do not.
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
    // Pick the probe target based on backend mode.
    const mode = await getBackendMode();
    const haveWorker = Boolean(await readCf("workerUrl")) && Boolean(await readCf("workerApiKey"));
    const useCloudflare = mode === "cloudflare" || (mode === "auto" && haveWorker);

    let apiBase: string;
    let probeUrl: string;
    if (useCloudflare) {
      const w = await readCf("workerUrl");
      apiBase = (w ?? "").replace(/\/$/, "");
      probeUrl = `${apiBase}/health`;
    } else {
      apiBase = await getApiBaseUrl();
      probeUrl = `${apiBase.replace(/\/$/, "")}/api/health`;
    }

    const r = await probe(probeUrl);
    last = {
      reachable: r.ok,
      online: net.isOnline(),
      apiBaseUrl: apiBase,
      lastCheckedAt: Date.now(),
      latencyMs: r.latencyMs,
      status: r.status,
      error: r.error,
    };
    broadcast(last);
  } catch (err: any) {
    last = { ...last, reachable: false, online: net.isOnline(), error: err?.message ?? String(err), lastCheckedAt: Date.now() };
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
  // First probe immediately, then on interval
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
