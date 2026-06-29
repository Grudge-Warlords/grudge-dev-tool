import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Play, Square, ExternalLink, RefreshCw, FolderOpen,
  Terminal, Loader2, AlertCircle, CheckCircle2,
} from "lucide-react";

interface CoderStatus {
  running: boolean;
  port: number;
  url: string;
  pid: number | null;
  projectDir: string | null;
  error: string | null;
}

const DEFAULT_PORT = 5111;
const DEFAULT_DIRS = [
  "D:\\GrudgeRepos\\RTS-Grudge",
  "D:\\repos\\grudge-dev-tool-gh",
  "C:\\Users\\david\\grudge-build",
  "F:\\GitHub\\GrudachainCode",
];

export default function Coder() {
  const [status, setStatus] = useState<CoderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [projectDir, setProjectDir] = useState(DEFAULT_DIRS[0]);

  const refresh = useCallback(async () => {
    try {
      const s = await window.grudge.coder.status();
      setStatus(s);
      if (s.port) setPort(s.port);
      if (s.projectDir) setProjectDir(s.projectDir);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function pickDir() {
    try {
      const picked = await window.grudge.coder.pickProjectDir();
      if (picked) setProjectDir(picked);
    } catch (e: any) {
      toast.error("Folder picker failed", { description: e?.message });
    }
  }

  async function launch() {
    setBusy(true);
    try {
      const s = await window.grudge.coder.launch({ port, projectDir });
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

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Terminal size={22} />
          GrudgeChain Coder
        </h1>
        <p className="muted text-sm">
          Local IDE for fleet game repos — Monaco, terminal, AI agents, Three.js live preview.
          Point workspace at RTS-Grudge, survival, or any game repo to edit assets in context.
        </p>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          {status?.running ? (
            <CheckCircle2 size={20} className="text-green-400" />
          ) : status?.error ? (
            <AlertCircle size={20} className="text-red-400" />
          ) : (
            <div className="w-5 h-5 rounded-full border-2 border-line" />
          )}
          <div className="flex-1">
            <div className="font-semibold text-sm">
              {status?.running ? "Running" : status?.error ? "Error" : "Stopped"}
            </div>
            {status?.running && (
              <div className="text-xs text-muted font-mono">
                PID {status?.pid} · {status?.url}
              </div>
            )}
            {status?.error && !status?.running && (
              <div className="text-xs text-red-400">{status.error}</div>
            )}
          </div>
          <button className="text-muted hover:text-gold" title="Refresh status" onClick={refresh}>
            <RefreshCw size={14} />
          </button>
        </div>

        {!status?.running && (
          <div className="space-y-3 mb-4">
            <label className="block text-xs">
              <span className="text-muted">Project directory (game repo workspace)</span>
              <div className="flex items-center gap-2 mt-1">
                <input
                  className="flex-1"
                  value={projectDir}
                  onChange={(e) => setProjectDir(e.target.value)}
                  placeholder="D:\GrudgeRepos\RTS-Grudge"
                />
                <button className="btn ghost" type="button" onClick={pickDir} title="Pick folder">
                  <FolderOpen size={14} />
                </button>
              </div>
            </label>
            <div className="flex flex-wrap gap-1">
              {DEFAULT_DIRS.map((d) => (
                <button key={d} type="button" className="btn ghost text-[10px] py-0 px-2" onClick={() => setProjectDir(d)}>
                  {d.split(/[/\\]/).pop()}
                </button>
              ))}
            </div>
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

        <div className="flex items-center gap-3">
          {!status?.running ? (
            <button className="btn flex items-center gap-2" onClick={launch} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Launch Coder
            </button>
          ) : (
            <>
              <button className="btn flex items-center gap-2" onClick={() => window.grudge.coder.open()}>
                <ExternalLink size={14} />
                Open in Browser
              </button>
              <button
                className="btn flex items-center gap-2 bg-red-900/30 border-red-800 hover:bg-red-900/50"
                onClick={stop}
                disabled={busy}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                Stop
              </button>
            </>
          )}
          <button
            className="btn ghost text-xs"
            onClick={() => window.grudge.os.openExternal("https://coder.grudge-studio.com")}
          >
            Cloud Coder
          </button>
        </div>
      </div>

      <div className="card text-xs text-muted space-y-2">
        <div className="font-semibold text-gold">Fleet workflow</div>
        <p>
          1. Browse assets in <strong>Store</strong> or <strong>Browser</strong> → open in <strong>Forge 3D</strong>.
          2. Export GLB → upload to R2 under <span className="font-mono">models/</span> prefixes.
          3. Launch Coder pointed at your game repo to wire assets into Three.js / R3F scenes.
        </p>
      </div>
    </div>
  );
}