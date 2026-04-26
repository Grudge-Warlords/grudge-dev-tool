import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, RefreshCcw, Power } from "lucide-react";
import { StatusDot } from "../components/StatusBar";

export default function Settings() {
  const [data, setData] = useState<any>(null);
  const [tools, setTools] = useState<any[]>([]);
  const [token, setToken] = useState("");
  const [bkKey, setBkKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [conn, setConn] = useState<any>(null);
  const [autoLaunch, setAutoLaunch] = useState(false);

  async function reload() {
    const d = await window.grudge.settings.get();
    setData(d);
    setApiBase(d.apiBaseUrl);
    const t = await window.grudge.settings.toolchain();
    setTools(t);
    try { setConn(await window.grudge.connectivity?.get?.()); } catch { /* */ }
    try { setAutoLaunch(!!(await window.grudge.autoLaunch?.get?.())); } catch { /* */ }
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
