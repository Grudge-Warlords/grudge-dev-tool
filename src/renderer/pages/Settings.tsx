import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, RefreshCcw, Power, Cloud, Bot, User, LogIn, LogOut, KeyRound, Save, Trash2, Download, Upload, Link2, ShieldCheck } from "lucide-react";
import { FLEET_CLIENT_URL } from "../../shared/fleet";
import { clearMirror } from "../lib/workspace";
import { getAdminOverride, setAdminOverride, isOpenMode } from "../lib/admin";
import { StatusDot } from "../components/StatusBar";


export default function Settings() {
  const [data, setData] = useState<any>(null);
  const [tools, setTools] = useState<any[]>([]);
  const [token, setToken] = useState("");
  const [bkKey, setBkKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [assetsApiBase, setAssetsApiBase] = useState("");
  const [conn, setConn] = useState<any>(null);
  const [autoLaunch, setAutoLaunch] = useState(false);

  const [session, setSession] = useState<any>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [cfStatus, setCfStatus] = useState<any>(null);
  const [backendMode, setBackendModeState] = useState<"auto" | "grudge" | "cloudflare" | "r2-direct" | "cloudflare-worker">("auto");
  const [workerHealthInfo, setWorkerHealthInfo] = useState<any>(null);
  const [r2HealthInfo, setR2HealthInfo] = useState<any>(null);
  const [aiHealthInfo, setAiHealthInfo] = useState<any>(null);
  const [cfAccountId, setCfAccountId] = useState("");
  const [cfGatewayId, setCfGatewayId] = useState("");
  const [cfWorkersToken, setCfWorkersToken] = useState("");
  const [legionHub, setLegionHub] = useState("");
  const [fleetKey, setFleetKey] = useState("");
  const [hasFleetKey, setHasFleetKey] = useState(false);
  const [adminOverride, setAdminOverrideState] = useState<"on" | "off" | "none">("none");

  async function reload() {
    const d = await window.grudge.settings.get();
    setData(d);
    setApiBase(d.apiBaseUrl);
    setAssetsApiBase(d.assetsApiBaseUrl ?? "");
    const t = await window.grudge.settings.toolchain();
    setTools(t);
    try { setConn(await window.grudge.connectivity?.get?.()); } catch { /* */ }
    try { setAutoLaunch(!!(await window.grudge.autoLaunch?.get?.())); } catch { /* */ }
    try { setCfStatus(await window.grudge.cf?.status?.()); } catch { /* */ }
    try { setBackendModeState((await window.grudge.cf?.getBackendMode?.()) ?? "auto"); } catch { /* */ }
    try { setSession(await window.grudge.auth?.getSession?.()); } catch { /* */ }
    try { setLegionHub(await window.grudge.legion?.getHubUrl?.() ?? ""); } catch { /* */ }
    try { setHasFleetKey(!!(await window.grudge.legion?.getFleetKey?.())); } catch { /* */ }
    setAdminOverrideState(getAdminOverride());
  }

  async function saveCfAi() {
    if (cfAccountId) await window.grudge.cf.set("accountId", cfAccountId.trim());
    if (cfGatewayId) await window.grudge.cf.set("aiGatewayId", cfGatewayId.trim());
    if (cfWorkersToken) await window.grudge.cf.set("aiWorkersApi", cfWorkersToken.trim());
    setCfAccountId("");
    setCfGatewayId("");
    setCfWorkersToken("");
    toast.success("Cloudflare AI credentials saved to Credential Vault");
    reload();
  }

  async function saveLegionHub() {
    if (!legionHub.trim()) return;
    await window.grudge.legion.setHubUrl(legionHub.trim());
    toast.success("Legion hub URL saved");
    reload();
  }

  async function saveFleetKey() {
    if (!fleetKey.trim()) return;
    await window.grudge.legion.setFleetKey(fleetKey.trim());
    setFleetKey("");
    toast.success("Fleet API key saved");
    reload();
  }

  async function clearCaches() {
    const cleared = await window.grudge.workspace.clearCaches();
    toast.success(`Cleared ${cleared.length} cache layers`, { description: cleared.join(", ") });
  }

  async function exportWorkspace() {
    const json = await window.grudge.workspace.export();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grudge-workspace-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Workspace exported");
  }

  async function importWorkspace() {
    const raw = prompt("Paste workspace JSON export:");
    if (!raw?.trim()) return;
    try {
      await window.grudge.workspace.import(raw);
      clearMirror();
      toast.success("Workspace imported — restart or change route to apply");
    } catch (e: any) {
      toast.error("Import failed", { description: e?.message });
    }
  }

  async function resetWorkspace() {
    if (!confirm("Reset saved route, Legion chat, and UI memory?")) return;
    await window.grudge.workspace.reset();
    clearMirror();
    toast.success("Workspace memory reset");
  }

  async function signInWithPuter(external = false) {
    setSigningIn(true);
    try {
      toast.info(external ? "Opening system browser…" : "Opening Puter sign-in…", { duration: 5000 });
      const r = external
        ? await window.grudge.auth.puterLoginExternal()
        : await window.grudge.auth.puterLogin();
      toast.success(`Signed in as ${r.user.username} · ${r.grudgeId}`);
      reload();
    } catch (e: any) {
      toast.error("Sign-in failed", { description: e?.message ?? String(e) });
    } finally { setSigningIn(false); }
  }
  async function signOutLocal() {
    await window.grudge.auth.clearSession();
    toast.success("Signed out");
    reload();
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
  async function saveAssetsApiBase() {
    if (!assetsApiBase.trim()) {
      await window.grudge.settings.clearAssetsApiBase();
    } else {
      await window.grudge.settings.setAssetsApiBase(assetsApiBase);
    }
    reload();
  }
  async function applyOneTruthPreset() {
    await window.grudge.settings.setApiBase(FLEET_CLIENT_URL);
    await window.grudge.settings.clearAssetsApiBase();
    setApiBase(FLEET_CLIENT_URL);
    setAssetsApiBase("");
    toast.success("ONE TRUTH preset applied", { description: FLEET_CLIENT_URL });
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
        <h3 className="flex items-center gap-2" style={{ margin: "0 0 8px" }}>
          <ShieldCheck size={16} className="text-gold" /> Admin access
        </h3>
        <p className="muted text-xs mb-2">
          Admin surfaces: Upload, Forge 3D, Coder, BlenderKit, Play Modes, Preview, Settings.
          {isOpenMode() && " OPEN MODE — all signed-in users are admin (dev only)."}
          {!isOpenMode() && " Operators: grudachain, molochdadev — see Account tab for wallet & GBUX."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button className={`btn ghost text-xs ${adminOverride === "on" ? "border-gold text-gold" : ""}`} onClick={() => { setAdminOverride("on"); setAdminOverrideState("on"); toast.success("Admin override ON — reload route to apply"); }}>
            Force admin ON
          </button>
          <button className={`btn ghost text-xs ${adminOverride === "off" ? "border-gold text-gold" : ""}`} onClick={() => { setAdminOverride("off"); setAdminOverrideState("off"); toast.info("Admin override OFF"); }}>
            Force admin OFF
          </button>
          <button className="btn ghost text-xs" onClick={() => { setAdminOverride("clear"); setAdminOverrideState("none"); toast.success("Admin override cleared"); }}>
            Clear override
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="flex items-center gap-2" style={{ margin: "0 0 8px" }}>
          <User size={16} className="text-gold" /> Grudge identity
        </h3>
        {session?.signedIn ? (
          <>
            <table>
              <tbody>
                <tr><td className="muted">Grudge ID</td><td className="font-mono text-gold">{session.grudgeId}</td></tr>
                <tr><td className="muted">Puter username</td><td className="font-mono">{session.puterUser?.username}</td></tr>
                <tr><td className="muted">Puter UUID</td><td className="font-mono">{session.puterUser?.uuid}</td></tr>
                {session.puterUser?.email && (
                  <tr><td className="muted">Email</td><td>{session.puterUser.email} {session.puterUser.email_verified ? <span className="status-ok">✓</span> : <span className="muted">(unverified)</span>}</td></tr>
                )}
              </tbody>
            </table>
            <div className="flex gap-2 mt-3">
              <button className="btn ghost danger flex items-center gap-1" onClick={signOutLocal}>
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted text-sm mb-3">Sign in with Puter to mint a Grudge ID. Saves and uploads sync to your Puter cloud.</p>
            <button className="btn flex items-center gap-2" onClick={() => signInWithPuter(false)} disabled={signingIn}>
              <LogIn size={14} />
              {signingIn ? "Signing in…" : "Sign in / Create Grudge account"}
            </button>
            <button className="btn ghost flex items-center gap-2 mt-2" onClick={() => signInWithPuter(true)} disabled={signingIn}>
              Sign in with system browser
            </button>
          </>
        )}
        <div style={{ marginTop: 12 }}>
          <label className="muted text-xs flex items-center gap-1"><Link2 size={12} /> Fleet client URL</label>
          <div className="row" style={{ marginTop: 4 }}>
            <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder={FLEET_CLIENT_URL} />
            <button className="btn ghost" onClick={saveApiBase}>Save</button>
            <button className="btn ghost text-gold" onClick={applyOneTruthPreset} title="Set client.grudge-studio.com and clear legacy split-host overrides">
              ONE TRUTH
            </button>
          </div>
          <div className="muted text-[10px] mt-1">
            One URL for fleet manifest, auth, objectstore JSON, and uploads via Vercel rewrites. Matches <span className="kbd">grudge-dev doctor</span>.
          </div>
        </div>
        <details style={{ marginTop: 8 }}>
          <summary className="muted text-xs cursor-pointer">Legacy split-host override (optional)</summary>
          <div className="row" style={{ marginTop: 4 }}>
            <input value={assetsApiBase} onChange={(e) => setAssetsApiBase(e.target.value)} placeholder="same as fleet client (default)" />
            <button className="btn ghost" onClick={saveAssetsApiBase}>Save</button>
          </div>
          <div className="muted text-[10px] mt-1">
            Leave empty for ONE TRUTH. Set only when objectstore routes to a separate host (e.g. <span className="font-mono">assets-api.grudge-studio.com</span>).
          </div>
        </details>
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
            <tr><td className="muted">Fleet client</td><td className="font-mono">{conn?.apiBaseUrl ?? "—"}</td></tr>
            <tr>
              <td className="muted">ONE TRUTH</td>
              <td className={conn?.reachable ? "status-ok" : "status-bad"}>
                {conn?.truthScore != null
                  ? `${conn.truthScore}%${conn.reachable ? " · healthy" : " · degraded"}`
                  : conn?.reachable ? `reachable · ${conn.latencyMs ?? 0}ms` : `unreachable${conn?.error ? ` · ${conn.error}` : ""}`}
              </td>
            </tr>
            {conn?.probes?.length ? (
              conn.probes.map((p: any) => (
                <tr key={p.id}>
                  <td className="muted pl-2">{p.label}</td>
                  <td className={p.ok ? "status-ok" : "status-bad"}>
                    {p.ok ? `✓ ${p.status ?? "OK"} · ${p.latencyMs ?? 0}ms` : `✗ ${p.detail ?? p.status ?? "fail"}`}
                  </td>
                </tr>
              ))
            ) : null}
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
            AI: {aiHealthInfo.phase === "checking" ? "…" : (aiHealthInfo.ok
              ? `OK · ${aiHealthInfo.latencyMs}ms${aiHealthInfo.via ? ` · ${aiHealthInfo.via}` : ""}`
              : <span className="status-bad">{aiHealthInfo.error}</span>)}
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-line">
          <div className="muted text-xs mb-2">Direct CF AI Gateway (optional — without these, AI routes through Legion hub after sign-in)</div>
          <div className="row" style={{ marginTop: 4 }}>
            <input placeholder="CF_ACCOUNT_ID" value={cfAccountId} onChange={(e) => setCfAccountId(e.target.value)} />
            <input placeholder="CF_AI_GATEWAY_ID" value={cfGatewayId} onChange={(e) => setCfGatewayId(e.target.value)} />
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            <input type="password" placeholder="CF_AI_WORKERS_API token" value={cfWorkersToken} onChange={(e) => setCfWorkersToken(e.target.value)} className="flex-1" />
            <button className="btn ghost flex items-center gap-1" onClick={saveCfAi}><Save size={14} /> Save CF AI</button>
          </div>
          <div className="muted text-[10px] mt-1">Or run: <span className="kbd">npm run secret:import path\to\secrets.txt</span></div>
        </div>
        <div className="mt-3 pt-3 border-t border-line">
          <div className="muted text-xs mb-2">Legion AI Hub (fleet REST — default when CF gateway creds missing)</div>
          <div className="row" style={{ marginTop: 4 }}>
            <input placeholder="https://ai.grudge-studio.com" value={legionHub} onChange={(e) => setLegionHub(e.target.value)} className="flex-1" />
            <button className="btn ghost" onClick={saveLegionHub}>Save hub</button>
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            <input type="password" placeholder={hasFleetKey ? "Fleet key stored (paste to replace)" : "GRUDGE_AI_KEY / fleet bearer"} value={fleetKey} onChange={(e) => setFleetKey(e.target.value)} className="flex-1" />
            <button className="btn ghost" onClick={saveFleetKey}>Save key</button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ margin: "0 0 8px" }}>Workspace memory</h3>
        <p className="muted text-sm mb-3">Persists active route, Legion chat, and UI state across tray hide and restart (electron-store + localStorage).</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn ghost flex items-center gap-1" onClick={exportWorkspace}><Download size={14} /> Export</button>
          <button className="btn ghost flex items-center gap-1" onClick={importWorkspace}><Upload size={14} /> Import</button>
          <button className="btn ghost danger flex items-center gap-1" onClick={resetWorkspace}><Trash2 size={14} /> Reset memory</button>
          <button className="btn ghost flex items-center gap-1" onClick={clearCaches}><RefreshCcw size={14} /> Clear caches</button>
        </div>
      </div>

      <div className="card">
        <h3 className="flex items-center gap-2" style={{ margin: "0 0 8px" }}>
          <Bot size={16} className="text-gold" /> Ollama (Local AI)
        </h3>
        <OllamaSettings />
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

function OllamaSettings() {
  const [host, setHost] = useState("http://localhost:11434");
  const [model, setModel] = useState("");
  const [pref, setPref] = useState<"auto" | "ollama" | "cloudflare">("auto");
  const [models, setModels] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function reloadOllama() {
    try {
      const h = await window.grudge.ollama.getHost();
      const m = await window.grudge.ollama.getModel();
      const p = await window.grudge.ollama.getAiPref();
      setHost(h);
      setModel(m);
      setPref((p as any) || "auto");
      await testOllama(false);
      try { setModels(await window.grudge.ollama.models()); } catch { setModels([]); }
    } catch { /* ignore */ }
  }

  async function testOllama(showToast = true) {
    setBusy(true);
    try {
      const h = await window.grudge.ollama.health();
      setHealth(h);
      if (showToast) toast[h.ok ? "success" : "error"](h.ok ? "Ollama reachable" : "Ollama unavailable", {
        description: h.ok ? `${h.latencyMs}ms${h.version ? ` · ${h.version}` : ""}` : h.error,
      });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    await window.grudge.ollama.setHost(host);
    await window.grudge.ollama.setModel(model);
    await window.grudge.ollama.setAiPref(pref);
    toast.success("Ollama settings saved");
    await reloadOllama();
  }

  async function quickPrompt() {
    setBusy(true);
    try {
      const r = await window.grudge.ollama.generate({
        model: model || undefined,
        system: "You are Grudge AI inside Grudge Studio. Keep replies short and useful.",
        prompt: "Say Grudge AI is online and ready.",
      });
      toast.success("Ollama response", { description: r.response?.slice(0, 180) ?? "OK" });
    } catch (e: any) {
      toast.error("Ollama prompt failed", { description: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void reloadOllama(); }, []);

  return (
    <div className="space-y-3">
      <table>
        <tbody>
          <tr>
            <td className="muted">Status</td>
            <td className={health?.ok ? "status-ok" : "status-bad"}>
              {health ? (health.ok ? `online · ${health.latencyMs}ms${health.version ? ` · ${health.version}` : ""}` : `offline · ${health.error}`) : "not checked"}
            </td>
          </tr>
          <tr><td className="muted">Models</td><td>{models.length ? models.map((m) => m.name).join(", ") : "—"}</td></tr>
        </tbody>
      </table>
      <div className="row">
        <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="http://localhost:11434" />
        <select value={model} onChange={(e) => setModel(e.target.value)} style={{ minWidth: 180 }}>
          <option value="">Auto-pick model</option>
          {models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
        </select>
        <select value={pref} onChange={(e) => setPref(e.target.value as any)} style={{ minWidth: 150 }}>
          <option value="auto">Auto fallback</option>
          <option value="ollama">Prefer Ollama</option>
          <option value="cloudflare">Prefer Cloud AI</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button className="btn ghost" onClick={save} disabled={busy}>Save</button>
        <button className="btn ghost" onClick={() => testOllama(true)} disabled={busy}>Test Ollama</button>
        <button className="btn ghost" onClick={quickPrompt} disabled={busy || !health?.ok}>Prompt Test</button>
      </div>
      <p className="muted text-xs">
        Local Ollama is used for free/private Grudge AI work when available. Cloud AI remains a fallback for deployed workers and shared jobs.
      </p>
    </div>
  );
}
