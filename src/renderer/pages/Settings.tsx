import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, RefreshCcw, Power, Cloud, Bot } from "lucide-react";
import { StatusDot } from "../components/StatusBar";

export default function Settings() {
  const [data, setData] = useState<any>(null);
  const [tools, setTools] = useState<any[]>([]);
  const [token, setToken] = useState("");
  const [bkKey, setBkKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [conn, setConn] = useState<any>(null);
  const [autoLaunch, setAutoLaunch] = useState(false);

  const [cfStatus, setCfStatus] = useState<any>(null);
  const [backendMode, setBackendModeState] = useState<"auto" | "grudge" | "cloudflare" | "r2-direct" | "cloudflare-worker">("auto");
  const [workerHealthInfo, setWorkerHealthInfo] = useState<any>(null);
  const [r2HealthInfo, setR2HealthInfo] = useState<any>(null);
  const [aiHealthInfo, setAiHealthInfo] = useState<any>(null);

  async function reload() {
    const d = await window.grudge.settings.get();
    setData(d);
    setApiBase(d.apiBaseUrl);
    const t = await window.grudge.settings.toolchain();
    setTools(t);
    try { setConn(await window.grudge.connectivity?.get?.()); } catch { /* */ }
    try { setAutoLaunch(!!(await window.grudge.autoLaunch?.get?.())); } catch { /* */ }
    try { setCfStatus(await window.grudge.cf?.status?.()); } catch { /* */ }
    try { setBackendModeState((await window.grudge.cf?.getBackendMode?.()) ?? "auto"); } catch { /* */ }
  }

  async function testWorker() {
    setWorkerHealthInfo({ phase: "checking" });
    try { setWorkerHealthInfo(await window.grudge.cf.workerHealth()); }
    catch (e: any) { setWorkerHealthInfo({ ok: false, error: e?.message ?? String(e) }); }
  }
  async function testR2() {
    setR2HealthInfo({ phase: "checking" });
    try { setR2HealthInfo(await window.grudge.cf.r2Health()); }
    catch (e: any) { setR2HealthInfo({ ok: false, error: e?.message ?? String(e) }); }
  }
  async function testAi() {
    setAiHealthInfo({ phase: "checking" });
    try { setAiHealthInfo(await window.grudge.cf.aiHealth()); }
    catch (e: any) { setAiHealthInfo({ ok: false, error: e?.message ?? String(e) }); }
  }
  async function chooseBackend(mode: "auto" | "grudge" | "cloudflare" | "r2-direct" | "cloudflare-worker") {
    await window.grudge.cf.setBackendMode(mode);
    setBackendModeState(mode);
    toast.success(`Backend mode: ${mode}`);
  }

  useEffect(() => {
    reload();
    const off = window.grudge.connectivity?.onChange?.((s: any) => setConn(s));
    return () => off?.();
  }, []);

  async function toggleAutoLaunch() {
    const next = !autoLaunch;
    const result = await window.grudge.autoLaunch.set(next);
    setAutoLaunch(!!result);
    toast.success(result ? "Will launch on Windows startup" : "Auto-launch disabled");
  }
  async function checkForUpdates() {
    toast.info("Checking for updates…");
    try { await window.grudge.updater.check(); } catch (e: any) { toast.error(e?.message ?? "check failed"); }
  }
  async function openLogs() {
    await window.grudge.diag.openLogFolder();
  }

  async function saveApiBase() {
    await window.grudge.settings.setApiBase(apiBase);
    reload();
  }
  async function saveToken() {
    if (!token) return;
    await window.grudge.settings.setToken(token);
    setToken("");
    reload();
  }
  async function clearToken() { await window.grudge.settings.clearToken(); reload(); }
  async function saveBkKey() {
    if (!bkKey) return;
    await window.grudge.settings.setBlenderKitKey(bkKey);
    setBkKey("");
    reload();
  }
  async function clearBkKey() { await window.grudge.settings.clearBlenderKitKey(); reload(); }

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">All secrets stored in Windows Credential Vault via <span className="kbd">keytar</span>.</p>

      <div className="card">
        <h3 style={{ margin: "0 0 8px" }}>Grudge backend</h3>
        <label className="muted">API base URL</label>
        <div className="row">
          <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
          <button className="btn" onClick={saveApiBase}>Save</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="muted">Grudge bearer token (paste once)</label>
          <div className="row">
            <input type="password" placeholder="paste token" value={token} onChange={(e) => setToken(e.target.value)} />
            <button className="btn" onClick={saveToken}>Save token</button>
            {data?.hasToken && <button className="btn ghost danger" onClick={clearToken}>Clear</button>}
          </div>
          <div className="muted" style={{ marginTop: 4 }}>{data?.hasToken ? "✓ token stored" : "no token stored"}</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ margin: "0 0 8px" }}>BlenderKit</h3>
        <label className="muted">BlenderKit API key</label>
        <div className="row">
          <input type="password" placeholder="bk_…" value={bkKey} onChange={(e) => setBkKey(e.target.value)} />
          <button className="btn" onClick={saveBkKey}>Save</button>
          {data?.hasBlenderKitKey && <button className="btn ghost danger" onClick={clearBkKey}>Clear</button>}
        </div>
        <div className="muted" style={{ marginTop: 4 }}>{data?.hasBlenderKitKey ? "✓ key stored" : "no key stored"}</div>
      </div>

      <div className="card">
        <h3 className="flex items-center gap-2" style={{ margin: "0 0 8px" }}>
          <StatusDot state={!conn ? "idle" : !conn.online ? "bad" : conn.reachable ? "ok" : "warn"} />
          Diagnostics
        </h3>
        <table>
          <tbody>
            <tr><td className="muted">API base</td><td className="font-mono">{conn?.apiBaseUrl ?? "—"}</td></tr>
            <tr>
              <td className="muted">Reachable</td>
              <td className={conn?.reachable ? "status-ok" : "status-bad"}>
                {conn?.reachable ? `yes · ${conn.latencyMs ?? 0}ms` : `no${conn?.error ? ` · ${conn.error}` : ""}`}
              </td>
            </tr>
            <tr><td className="muted">OS network</td><td>{conn?.online ? "online" : "offline"}</td></tr>
            <tr><td className="muted">Last checked</td><td className="muted">{conn?.lastCheckedAt ? new Date(conn.lastCheckedAt).toLocaleTimeString() : "—"}</td></tr>
          </tbody>
        </table>
        <div className="flex gap-2 mt-3">
          <button className="btn ghost flex items-center gap-1" onClick={openLogs}>
            <FolderOpen size={14} /> Open log folder
          </button>
          <button className="btn ghost flex items-center gap-1" onClick={checkForUpdates}>
            <RefreshCcw size={14} /> Check for updates
          </button>
          <button
            className={"btn ghost flex items-center gap-1 " + (autoLaunch ? "text-ok" : "")}
            onClick={toggleAutoLaunch}
            title="Launch on Windows startup"
          >
            <Power size={14} /> Auto-launch: {autoLaunch ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="flex items-center gap-2" style={{ margin: "0 0 8px" }}>
          <Cloud size={16} className="text-gold" /> Cloudflare R2 + AI Gateway
        </h3>
        <table>
          <tbody>
            <tr><td className="muted">Worker URL</td><td>{cfStatus?.worker?.url ? <span className="status-ok">stored</span> : <span className="status-bad">missing</span>}</td></tr>
            <tr><td className="muted">Worker API key</td><td>{cfStatus?.worker?.apiKey ? <span className="status-ok">stored</span> : <span className="status-bad">missing</span>}</td></tr>
            <tr><td className="muted">R2 (S3-compat) creds</td><td>{cfStatus?.direct?.endpoint && cfStatus?.direct?.accessKeyId && cfStatus?.direct?.secret ? <span className="status-ok">complete</span> : <span className="muted">partial / unused</span>}</td></tr>
            <tr><td className="muted">AI Workers token</td><td>{cfStatus?.ai?.token ? <span className="status-ok">stored</span> : <span className="status-bad">missing</span>}</td></tr>
            <tr><td className="muted">AI Gateway id</td><td>{cfStatus?.ai?.gatewayId ? <span className="status-ok">stored</span> : <span className="muted">missing</span>}</td></tr>
            <tr><td className="muted">Public CDN</td><td className="font-mono">{cfStatus?.publicCdn ?? "—"}</td></tr>
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2 mt-3 items-center">
          <span className="muted text-xs">Backend:</span>
          {(["auto", "r2-direct", "cloudflare-worker", "grudge"] as const).map((m) => (
            <button
              key={m}
              className={"btn ghost " + (backendMode === m ? "text-gold border-gold" : "")}
              onClick={() => chooseBackend(m)}
            >
              {m}
            </button>
          ))}
          <span className="flex-1" />
          <button className="btn ghost flex items-center gap-1" onClick={testR2}>
            <RefreshCcw size={14} /> Test R2
          </button>
          <button className="btn ghost flex items-center gap-1" onClick={testWorker}>
            <RefreshCcw size={14} /> Test Worker
          </button>
          <button className="btn ghost flex items-center gap-1" onClick={testAi}>
            <Bot size={14} /> Test AI
          </button>
        </div>
        {r2HealthInfo && (
          <div className="muted text-xs mt-1">
            R2 (direct): {r2HealthInfo.phase === "checking" ? "…" : (r2HealthInfo.ok ? `OK · ${r2HealthInfo.latencyMs}ms · ${r2HealthInfo.bucket}` : <span className="status-bad">{r2HealthInfo.error}</span>)}
          </div>
        )}
        {workerHealthInfo && (
          <div className="muted text-xs mt-1">
            Worker: {workerHealthInfo.phase === "checking" ? "…" : (workerHealthInfo.ok ? `OK · ${workerHealthInfo.latencyMs}ms` : <span className="status-bad">{workerHealthInfo.error}</span>)}
          </div>
        )}
        {aiHealthInfo && (
          <div className="muted text-xs">
            AI Gateway: {aiHealthInfo.phase === "checking" ? "…" : (aiHealthInfo.ok ? `OK · ${aiHealthInfo.latencyMs}ms` : <span className="status-bad">{aiHealthInfo.error}</span>)}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ margin: "0 0 8px" }}>Toolchain</h3>
        <table>
          <thead><tr><th>Tool</th><th>Status</th><th>Version / path</th></tr></thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.name}>
                <td>{t.name}</td>
                <td className={t.available ? "status-ok" : "status-bad"}>{t.available ? "available" : "missing"}</td>
                <td className="muted">{t.version ?? t.reason ?? t.path ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
