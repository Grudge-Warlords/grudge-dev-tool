import React, { useCallback, useEffect, useState } from "react";
import {
  Play, Square, Hammer, Globe, RefreshCw, Loader2, ExternalLink, Server, Code2,
} from "lucide-react";
import { toast } from "sonner";
import type { DevProject } from "../../shared/devProjects";

interface DevServerStatus {
  projectId: string;
  running: boolean;
  mode: string | null;
  port: number;
  url: string;
  pid: number | null;
  error: string | null;
  building: boolean;
  lastLog: string[];
}

interface Props {
  onOpenPreview: (url: string) => void;
}

export default function DevEnvironmentPanel({ onOpenPreview }: Props) {
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [status, setStatus] = useState<DevServerStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = projects.find((p) => p.id === selectedId) ?? projects[0] ?? null;

  const refresh = useCallback(async () => {
    try {
      const list: DevProject[] = await window.grudge.devEnv.listProjects();
      setProjects(list);
      if (!selectedId && list[0]) setSelectedId(list[0].id);
      if (selectedId || list[0]?.id) {
        const id = selectedId || list[0]!.id;
        const st = await window.grudge.devEnv.status(id);
        setStatus(st);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Dev env refresh failed", { description: msg });
    }
  }, [selectedId]);

  useEffect(() => {
    refresh();
    const off = window.grudge.devEnv.onChanged?.(() => refresh());
    const poll = setInterval(refresh, 4000);
    return () => {
      off?.();
      clearInterval(poll);
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) return;
    window.grudge.devEnv.status(selectedId).then(setStatus).catch(() => {});
  }, [selectedId]);

  async function run(action: () => Promise<DevServerStatus>, label: string) {
    setBusy(true);
    try {
      const result = await action();
      setStatus(result);
      if (result.error) {
        toast.error(label, { description: result.error });
      } else {
        toast.success(label);
        if (result.url) onOpenPreview(result.url);
      }
      await refresh();
    } catch (err: unknown) {
      toast.error(label, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  if (projects.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted border-b border-line bg-bg-2/20">
        No dev projects found. Add roots in Coder → Manifest or edit{" "}
        <span className="font-mono">grudge-dev-manifest.json</span>.
      </div>
    );
  }

  return (
    <div className="border-b border-line bg-bg-2/30">
      <div className="px-3 py-2 flex flex-wrap items-center gap-2">
        <Server size={14} className="text-gold shrink-0" />
        <span className="text-xs font-semibold text-gold">Dev Environment</span>
        <select
          className="text-xs font-mono bg-bg-2 border border-line rounded px-2 py-1 max-w-[220px]"
          value={selectedId || selected?.id || ""}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {status?.running && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">
            {status.mode ?? "dev"} · :{status.port || "?"}
          </span>
        )}
        <div className="flex items-center gap-1 ml-auto flex-wrap">
          <button
            type="button"
            className="btn text-[10px] py-1 px-2 flex items-center gap-1"
            disabled={busy || !selected}
            onClick={() =>
              run(() => window.grudge.devEnv.startDev(selected!.id), "Dev server started")
            }
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Dev
          </button>
          <button
            type="button"
            className="btn ghost text-[10px] py-1 px-2 flex items-center gap-1"
            disabled={busy || !selected}
            onClick={() =>
              run(() => window.grudge.devEnv.stopDev(selected!.id), "Dev server stopped")
            }
          >
            <Square size={12} /> Stop
          </button>
          <button
            type="button"
            className="btn ghost text-[10px] py-1 px-2 flex items-center gap-1"
            disabled={busy || !selected}
            onClick={() =>
              run(
                () => window.grudge.devEnv.buildAndPreview(selected!.id),
                "Build complete — opening preview",
              )
            }
          >
            <Hammer size={12} /> Build
          </button>
          {selected?.remoteDevUrl && (
            <button
              type="button"
              className="btn ghost text-[10px] py-1 px-2 flex items-center gap-1"
              onClick={() => onOpenPreview(selected.remoteDevUrl!)}
            >
              <Globe size={12} /> Remote
            </button>
          )}
          {status?.url && (
            <button
              type="button"
              className="btn ghost text-[10px] py-1 px-2 flex items-center gap-1"
              onClick={() => onOpenPreview(status.url)}
            >
              <ExternalLink size={12} /> Open
            </button>
          )}
          {selected && (
            <button
              type="button"
              className="btn ghost text-[10px] py-1 px-2 flex items-center gap-1"
              disabled={busy}
              title="Open in Coder with PTY, npm, and project workspace"
              onClick={async () => {
                try {
                  await window.grudge.coder.openProject(selected.id);
                } catch (err: unknown) {
                  toast.error("Open in Coder failed", {
                    description: err instanceof Error ? err.message : String(err),
                  });
                }
              }}
            >
              <Code2 size={12} /> Coder
            </button>
          )}
          <button type="button" className="p-1 rounded hover:bg-bg-2" onClick={refresh} title="Refresh">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>
      {selected?.description && (
        <p className="px-3 pb-1 text-[10px] text-muted">{selected.description}</p>
      )}
      {status?.lastLog && status.lastLog.length > 0 && (
        <pre className="mx-3 mb-2 max-h-16 overflow-auto text-[9px] font-mono text-muted bg-bg-0/60 rounded p-1.5 border border-line/50">
          {status.lastLog.slice(-6).join("\n")}
        </pre>
      )}
    </div>
  );
}