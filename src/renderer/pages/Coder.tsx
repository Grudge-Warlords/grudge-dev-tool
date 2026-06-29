import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Play, Square, ExternalLink, RefreshCw, FolderOpen,
  Terminal, Loader2, AlertCircle, CheckCircle2, Sparkles,
  Bot, Globe, Code2, Zap, ChevronRight,
} from "lucide-react";
import { useWorkspaceField } from "../lib/useWorkspaceField";

interface CoderStatus {
  running: boolean;
  port: number;
  url: string;
  pid: number | null;
  projectDir: string | null;
  error: string | null;
}

const DEFAULT_PORT = 5111;
const PROD_URL = "https://coder.grudge-studio.com";

const CODER_PROMPTS = [
  "Scaffold a new Grudge game module with TypeScript + Vite.",
  "Wire HuggingFace local inference into the coder AI panel.",
  "Add R2 asset picker to the file tree sidebar.",
  "Generate a PvP arena config JSON from fleet catalog.",
];

export default function Coder() {
  const [status, setStatus] = useState<CoderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [port, setPort] = useWorkspaceField("coderPort", DEFAULT_PORT);
  const [coderRoot, setCoderRoot] = useWorkspaceField("coderRoot", "");
  const [projectDir, setProjectDir] = useWorkspaceField("coderProjectDir", "");
  const [hfHealth, setHfHealth] = useState<any>(null);
  const [hfModel, setHfModel] = useState("Qwen/Qwen2.5-Coder-7B-Instruct");
  const [hfModels, setHfModels] = useState<string[]>([]);
  const [grudaHealth, setGrudaHealth] = useState<any>(null);
  const [showPreview, setShowPreview] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await window.grudge.coder.status();
      setStatus(s);
      if (s.port) setPort(s.port);
      if (s.projectDir) setProjectDir(s.projectDir);
    } catch { /* ignore */ }
    try {
      setHfHealth(await window.grudge.ai.huggingfaceHealth?.());
      const cfg = await window.grudge.ai.getHfModel?.();
      if (cfg?.model) setHfModel(cfg.model);
      if (cfg?.options?.length) setHfModels(cfg.options);
    } catch { /* ignore */ }
    try {
      setGrudaHealth(await window.grudge.grudachain?.health?.());
    } catch { /* ignore */ }
  }, [setPort, setProjectDir]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  async function pickRoot() {
    const picked = await window.grudge.coder.pickRoot();
    if (!picked) return;
    setCoderRoot(picked);
    await window.grudge.coder.setPrefs({ coderRoot: picked });
    toast.success("IDE root saved");
  }

  async function pickProject() {
    const picked = await window.grudge.coder.pickProject();
    if (!picked) return;
    setProjectDir(picked);
    await window.grudge.coder.setPrefs({ coderProjectDir: picked });
    toast.success("Project folder saved");
  }

  async function saveHfModel(model: string) {
    setHfModel(model);
    await window.grudge.ai.setHfModel?.(model);
    toast.success("HF coder model saved");
    refresh();
  }

  async function launch() {
    setBusy(true);
    try {
      await window.grudge.coder.setPrefs({ coderRoot, coderProjectDir: projectDir, coderPort: port });
      const s = await window.grudge.coder.launch({ port, projectDir, coderRoot: coderRoot || undefined });
      setStatus(s);
      if (s.running) {
        toast.success(`Coder running on port ${s.port}`);
      } else if (s.error) {
        toast.error("Launch failed", { description: s.error });
      }
    } catch (err: any) {
      toast.error("Launch failed", { description: err?.message ?? String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      const s = await window.grudge.coder.stop();
      setStatus(s);
      toast.success("Coder stopped");
    } catch (err: any) {
      toast.error("Stop failed", { description: err?.message ?? String(err) });
    } finally {
      setBusy(false);
    }
  }

  const running = status?.running ?? false;
  const localUrl = status?.url || (port ? `http://localhost:${port}` : "");

  return (
    <div className="coder-page">
      <header className="coder-hero">
        <div className="coder-hero-text">
          <h1 className="page-title flex items-center gap-2">
            <Code2 size={22} className="text-gold" />
            GrudgeChain Coder
          </h1>
          <p className="muted text-sm max-w-xl">
            Agentic localized IDE for <span className="font-mono text-gold">coder.grudge-studio.com</span>.
            HuggingFace powers inline AI when AnythingLLM RAG is offline. Press <span className="kbd">Ctrl+/</span> for GRUDA Chain anywhere.
          </p>
        </div>
        <div className="coder-hero-actions">
          <a className="btn ghost flex items-center gap-2 text-xs" href={PROD_URL} target="_blank" rel="noreferrer">
            <Globe size={14} /> Production
          </a>
          {running && localUrl && (
            <button className="btn flex items-center gap-2 text-xs" type="button" onClick={() => window.grudge.coder.open()}>
              <ExternalLink size={14} /> Open local
            </button>
          )}
        </div>
      </header>

      <div className="coder-ai-strip">
        <div className={`coder-ai-pill ${hfHealth?.ok ? "ok" : hfHealth?.configured ? "warn" : ""}`}>
          <Bot size={12} />
          <span>HuggingFace</span>
          <span className="coder-ai-detail">{hfHealth?.ok ? hfModel.split("/").pop() : hfHealth?.configured ? "error" : "no token"}</span>
        </div>
        <div className={`coder-ai-pill ${grudaHealth?.ok ? "ok" : ""}`}>
          <Sparkles size={12} />
          <span>GrudaChain RAG</span>
          <span className="coder-ai-detail">{grudaHealth?.ok ? grudaHealth.workspaceSlug : "offline"}</span>
        </div>
        <div className={`coder-ai-pill ${running ? "ok" : ""}`}>
          <Terminal size={12} />
          <span>Coder server</span>
          <span className="coder-ai-detail">{running ? `:${status?.port}` : "stopped"}</span>
        </div>
      </div>

      <div className="coder-layout">
        <aside className="coder-sidebar">
          <div className="card coder-card">
            <div className="flex items-center gap-3 mb-4">
              {running ? (
                <CheckCircle2 size={20} className="text-green-400 shrink-0" />
              ) : status?.error ? (
                <AlertCircle size={20} className="text-red-400 shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full border-2 border-line shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">
                  {running ? "Running locally" : status?.error ? "Error" : "Ready to launch"}
                </div>
                {running && (
                  <div className="text-xs text-muted font-mono truncate">
                    PID {status?.pid} · {localUrl}
                  </div>
                )}
                {status?.error && !running && (
                  <div className="text-xs text-red-400">{status.error}</div>
                )}
              </div>
              <button className="text-muted hover:text-gold shrink-0" title="Refresh" type="button" onClick={refresh}>
                <RefreshCw size={14} />
              </button>
            </div>

            {!running && (
              <div className="space-y-3 mb-4">
                <label className="block text-xs">
                  <span className="text-muted">GrudachainCode root</span>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      className="flex-1"
                      value={coderRoot}
                      onChange={(e) => setCoderRoot(e.target.value)}
                      placeholder="path to GrudachainCode (package.json)"
                    />
                    <button className="btn ghost text-xs" type="button" onClick={pickRoot} title="Browse">
                      <FolderOpen size={14} />
                    </button>
                  </div>
                </label>
                <label className="block text-xs">
                  <span className="text-muted">Project workspace</span>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      className="flex-1"
                      value={projectDir}
                      onChange={(e) => setProjectDir(e.target.value)}
                      placeholder="C:\Users\you\projects\my-game"
                    />
                    <button className="btn ghost text-xs" type="button" onClick={pickProject} title="Browse">
                      <FolderOpen size={14} />
                    </button>
                  </div>
                </label>
                <label className="block text-xs">
                  <span className="text-muted">Port</span>
                  <input
                    className="w-24 mt-1"
                    type="number"
                    min={1024}
                    max={65535}
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                  />
                </label>
              </div>
            )}

            <label className="block text-xs mb-4">
              <span className="text-muted flex items-center gap-1"><Zap size={11} /> HF coder model (local agentic)</span>
              <select
                className="w-full mt-1"
                value={hfModel}
                onChange={(e) => saveHfModel(e.target.value)}
              >
                {(hfModels.length ? hfModels : [hfModel]).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2 flex-wrap">
              {!running ? (
                <button className="btn flex items-center gap-2" type="button" onClick={launch} disabled={busy}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  Launch Coder
                </button>
              ) : (
                <>
                  <button className="btn flex items-center gap-2" type="button" onClick={() => window.grudge.coder.open()}>
                    <ExternalLink size={14} />
                    Browser
                  </button>
                  <button
                    className="btn flex items-center gap-2 bg-red-900/30 border-red-800 hover:bg-red-900/50"
                    type="button"
                    onClick={stop}
                    disabled={busy}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                    Stop
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="card coder-card">
            <h3 className="text-xs font-semibold text-gold mb-2 flex items-center gap-1">
              <Sparkles size={12} /> GRUDA quick prompts
            </h3>
            <p className="muted text-[10px] mb-2">Paste into Ctrl+/ overlay while coding</p>
            <ul className="coder-prompt-list">
              {CODER_PROMPTS.map((p) => (
                <li key={p}>
                  <ChevronRight size={10} className="text-gold shrink-0" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <section className="coder-main">
          {running && showPreview && localUrl ? (
            <div className="coder-preview-wrap">
              <div className="coder-preview-bar">
                <span className="font-mono text-xs text-muted truncate">{localUrl}</span>
                <button type="button" className="btn ghost text-xs" onClick={() => setShowPreview(false)}>
                  Hide preview
                </button>
              </div>
              <webview
                src={localUrl}
                partition="persist:grudge-coder"
                className="coder-webview"
                allowpopups
              />
            </div>
          ) : (
            <div className="coder-empty card">
              {running ? (
                <>
                  <Terminal size={32} className="text-gold opacity-60 mb-3" />
                  <p className="text-sm mb-3">Coder is running at <span className="font-mono text-gold">{localUrl}</span></p>
                  <button type="button" className="btn" onClick={() => setShowPreview(true)}>Show embedded preview</button>
                </>
              ) : (
                <>
                  <Code2 size={40} className="text-gold opacity-40 mb-4" />
                  <h2 className="text-lg font-semibold mb-2">Local vibe IDE</h2>
                  <p className="muted text-sm max-w-md text-center mb-4">
                    Point to your GrudachainCode checkout, pick a project folder, and launch.
                    HF token + model inject automatically for agentic completions.
                  </p>
                  <ol className="coder-steps muted text-xs text-left max-w-sm">
                    <li>1. Settings → paste HuggingFace token (stored in vault)</li>
                    <li>2. Pick GrudachainCode root + project workspace</li>
                    <li>3. Launch — preview embeds here when running</li>
                    <li>4. <span className="kbd">Ctrl+/</span> opens GRUDA Chain RAG overlay</li>
                  </ol>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}