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

export default function Coder() {
  const [status, setStatus] = useState<CoderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [projectDir, setProjectDir] = useState("F:\\GitHub\\GrudachainCode");

  const refresh = useCallback(async () => {
    try {
      const s = await (window as any).grudge.coder.status();
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

  async function launch() {
    setBusy(true);
    try {
      const s = await (window as any).grudge.coder.launch({ port, projectDir });
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
      const s = await (window as any).grudge.coder.stop();
      setStatus(s);
      toast.success("Coder stopped");
    } catch (err: any) {
      toast.error("Stop failed", { description: err?.message ?? String(err) });
    } finally {
      setBusy(false);
    }
  }

  function openBrowser() {
    (window as any).grudge.coder.open();
  }

  const running = status?.running ?? false;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Terminal size={22} />
          GrudgeChain Coder
        </h1>
        <p className="muted text-sm">
          Local IDE powered by GrudachainCode. Launch the server and open it in
          your browser for a full coding environment with terminal, file
          explorer, AI agents, and live preview.
        </p>
      </div>

      {/* Status card */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          {running ? (
            <CheckCircle2 size={20} className="text-green-400" />
          ) : status?.error ? (
            <AlertCircle size={20} className="text-red-400" />
          ) : (
            <div className="w-5 h-5 rounded-full border-2 border-line" />
          )}
          <div className="flex-1">
            <div className="font-semibold text-sm">
              {running ? "Running" : status?.error ? "Error" : "Stopped"}
            </div>
            {running && (
              <div className="text-xs text-muted font-mono">
                PID {status?.pid} · {status?.url}
              </div>
            )}
            {status?.error && !running && (
              <div className="text-xs text-red-400">{status.error}</div>
            )}
          </div>
          <button
            className="text-muted hover:text-gold"
            title="Refresh status"
            onClick={refresh}
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Config inputs (only when stopped) */}
        {!running && (
          <div className="space-y-3 mb-4">
            <label className="block text-xs">
              <span className="text-muted">Project directory</span>
              <div className="flex items-center gap-2 mt-1">
                <input
                  className="flex-1"
                  value={projectDir}
                  onChange={(e) => setProjectDir(e.target.value)}
                  placeholder="F:\GitHub\GrudachainCode"
                />
                <FolderOpen size={14} className="text-muted" />
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

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {!running ? (
            <button
              className="btn flex items-center gap-2"
              onClick={launch}
              disabled={busy}
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              Launch Coder
            </button>
          ) : (
            <>
              <button
                className="btn flex items-center gap-2"
                onClick={openBrowser}
              >
                <ExternalLink size={14} />
                Open in Browser
              </button>
              <button
                className="btn flex items-center gap-2 bg-red-900/30 border-red-800 hover:bg-red-900/50"
                onClick={stop}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Square size={14} />
                )}
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="card text-xs text-muted space-y-2">
        <div className="font-semibold text-gold">About GrudgeChain Coder</div>
        <p>
          Full-stack web IDE with Monaco editor, integrated terminal, AI coding
          agents, file explorer, and Three.js live preview. Connects to Puter
          for cloud saves and authentication.
        </p>
        <p>
          Cloud version: <span className="font-mono text-gold">coder.grudge-studio.com</span>
        </p>
        <p>
          Source: <span className="font-mono">F:\GitHub\GrudachainCode</span>
        </p>
      </div>
    </div>
  );
}
