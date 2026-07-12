/**
 * Projects — organized on-disk game packs with diagnose / auto-fix / best assets.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FolderKanban, Plus, RefreshCw, Wrench, FolderOpen, Loader2,
  AlertTriangle, CheckCircle2, Sparkles, ExternalLink, LayoutTemplate,
} from "lucide-react";

interface ProjectRow {
  dir: string;
  name: string;
  kind: string;
  updatedAt: string;
  sceneCount: number;
}

interface Issue {
  rule: string;
  severity: "error" | "warn" | "info";
  message: string;
  path?: string;
  hint?: string;
  autoFixable?: boolean;
}

export default function ProjectsPage() {
  const [root, setRoot] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [layout, setLayout] = useState("");
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("game");
  const [bestQuery, setBestQuery] = useState("character race");
  const [bestHits, setBestHits] = useState<any[]>([]);
  const [fixLog, setFixLog] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r, list, tree] = await Promise.all([
        window.grudge.projects.root(),
        window.grudge.projects.list(),
        window.grudge.projects.layout(),
      ]);
      setRoot(r);
      setProjects(list || []);
      setLayout(tree || "");
    } catch (e: any) {
      toast.error(e?.message || "Failed to list projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const diagnose = async (dir: string) => {
    setSelected(dir);
    setBusy(true);
    try {
      const r = await window.grudge.projects.diagnose(dir);
      setIssues(r.issues || []);
      if (r.ok) toast.success("Project looks healthy");
      else toast.message(`Found ${r.summary?.error ?? 0} errors, ${r.summary?.warn ?? 0} warnings`);
    } catch (e: any) {
      toast.error(e?.message || "Diagnose failed");
    } finally {
      setBusy(false);
    }
  };

  const autofix = async (dir: string) => {
    setSelected(dir);
    setBusy(true);
    try {
      const r = await window.grudge.projects.autofix(dir);
      setFixLog(r.fixed || []);
      setIssues(r.remaining || []);
      toast.success(`Auto-fix applied ${r.fixed?.length ?? 0} changes`);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Auto-fix failed");
    } finally {
      setBusy(false);
    }
  };

  const scaffold = async () => {
    if (!newName.trim()) {
      toast.error("Enter a project name");
      return;
    }
    setBusy(true);
    try {
      const r = await window.grudge.projects.scaffold({
        name: newName.trim(),
        kind: newKind,
      });
      toast.success(`Created ${r.manifest?.name || newName}`);
      setNewName("");
      setSelected(r.dir);
      await refresh();
      await diagnose(r.dir);
    } catch (e: any) {
      toast.error(e?.message || "Scaffold failed");
    } finally {
      setBusy(false);
    }
  };

  const searchBest = async () => {
    setBusy(true);
    try {
      const hits = await window.grudge.projects.bestAssets(bestQuery, 10);
      setBestHits(hits || []);
    } catch (e: any) {
      toast.error(e?.message || "Asset search failed");
    } finally {
      setBusy(false);
    }
  };

  const askAgent = async (dir: string) => {
    toast.message("Opening Legion with auto-fix prompt…");
    try {
      await window.grudge.workspace?.patch?.({ route: "/legion" });
      await window.grudge.app.openRoute("/legion");
      // Seed chat via mirror for Legion to pick up on next mount is hard —
      // show clipboard instruction
      const prompt = `Diagnose and auto-fix my Grudge project at:\n${dir}\nUse project_diagnose then project_autofix. Prefer Grudge6 race kits and path-stable UUIDs.`;
      await navigator.clipboard.writeText(prompt);
      toast.success("Prompt copied — paste into Legion (agentic ON)");
    } catch {
      /* */
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 p-1">
      <header className="shrink-0">
        <h1 className="page-title flex items-center gap-2 mb-0">
          <FolderKanban size={20} className="text-gold" />
          Projects
        </h1>
        <p className="page-sub mt-1 mb-0">
          Organized folders · diagnose · agentic auto-fix · best CDN assets.
          Root: <span className="font-mono text-[11px]">{root || "…"}</span>
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <button type="button" className="btn ghost text-xs" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw size={12} /> Refresh
          </button>
          <button
            type="button"
            className="btn ghost text-xs"
            disabled={busy}
            onClick={async () => {
              const p = await window.grudge.projects.pickRoot();
              if (p) { setRoot(p); await refresh(); }
            }}
          >
            <FolderOpen size={12} /> Change root
          </button>
          <button
            type="button"
            className="btn ghost text-xs"
            disabled={busy}
            onClick={async () => {
              try {
                const dir = await window.grudge.projects.pickOpen();
                if (dir) { setSelected(dir); await diagnose(dir); await refresh(); }
              } catch (e: any) {
                toast.error(e?.message || "Open failed");
              }
            }}
          >
            Open folder…
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0 overflow-auto">
        {/* Create */}
        <div className="card">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
            <Plus size={14} className="text-gold" /> New project
          </h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="flex-1 text-xs"
              placeholder="Project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void scaffold(); }}
            />
            <select
              className="text-xs"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value)}
            >
              <option value="game">game</option>
              <option value="rts">rts</option>
              <option value="rpg">rpg</option>
              <option value="sandbox">sandbox</option>
              <option value="scene-pack">scene-pack</option>
              <option value="tool">tool</option>
            </select>
            <button type="button" className="btn primary text-xs" disabled={busy} onClick={() => void scaffold()}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Scaffold
            </button>
          </div>
          <p className="muted text-[10px] mt-2">
            Creates <code>grudge.project.json</code>, scenes/, scripts/, assets/*, starter Main scene with Grudge6 human kit.
          </p>
        </div>

        {/* Layout cheat sheet */}
        <div className="card">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
            <LayoutTemplate size={14} className="text-gold" /> Canonical layout
          </h2>
          <pre className="text-[10px] font-mono text-muted whitespace-pre-wrap max-h-40 overflow-auto m-0">
            {layout || "Loading…"}
          </pre>
        </div>

        {/* List */}
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold mb-2">Your projects</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-muted text-xs"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : projects.length === 0 ? (
            <p className="muted text-xs">No projects yet — scaffold one above.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {projects.map((p) => (
                <div
                  key={p.dir}
                  className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                    selected === p.dir ? "border-gold/50 bg-gold/5" : "border-white/10"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="muted text-[10px] font-mono truncate">{p.dir}</div>
                    <div className="muted text-[10px]">{p.kind} · {p.sceneCount} scenes · {p.updatedAt?.slice(0, 10)}</div>
                  </div>
                  <button type="button" className="btn ghost text-[10px]" disabled={busy} onClick={() => void diagnose(p.dir)}>
                    Diagnose
                  </button>
                  <button type="button" className="btn ghost text-[10px]" disabled={busy} onClick={() => void autofix(p.dir)}>
                    <Wrench size={10} /> Auto-fix
                  </button>
                  <button type="button" className="btn ghost text-[10px]" disabled={busy} onClick={() => void askAgent(p.dir)}>
                    <Sparkles size={10} /> Agent
                  </button>
                  <button type="button" className="btn ghost text-[10px]" onClick={() => void window.grudge.projects.open(p.dir)}>
                    <ExternalLink size={10} /> Folder
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Issues + fix log */}
        <div className="card">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            {issues.some((i) => i.severity === "error")
              ? <AlertTriangle size={14} className="text-amber-400" />
              : <CheckCircle2 size={14} className="text-emerald-400" />}
            Diagnostics
          </h2>
          {fixLog.length > 0 && (
            <div className="mb-2 text-[10px] text-emerald-400/90">
              Fixed: {fixLog.join(" · ")}
            </div>
          )}
          {issues.length === 0 ? (
            <p className="muted text-xs">Run Diagnose on a project.</p>
          ) : (
            <ul className="space-y-1 max-h-56 overflow-auto m-0 p-0 list-none">
              {issues.map((iss, i) => (
                <li key={`${iss.rule}-${i}`} className="text-[11px] border-b border-white/5 py-1">
                  <span className={
                    iss.severity === "error" ? "text-red-400" :
                    iss.severity === "warn" ? "text-amber-400" : "text-muted"
                  }>
                    [{iss.severity}]
                  </span>{" "}
                  {iss.message}
                  {iss.hint && <div className="muted text-[10px] pl-2">{iss.hint}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Best assets */}
        <div className="card">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Sparkles size={14} className="text-gold" /> Best assets
          </h2>
          <div className="flex gap-1.5 mb-2">
            <input
              className="flex-1 text-xs"
              value={bestQuery}
              onChange={(e) => setBestQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void searchBest(); }}
              placeholder="race, vehicle, orc, vfx…"
            />
            <button type="button" className="btn ghost text-xs" disabled={busy} onClick={() => void searchBest()}>
              Search
            </button>
          </div>
          <ul className="space-y-1 max-h-56 overflow-auto m-0 p-0 list-none">
            {bestHits.map((h: any) => (
              <li key={h.path} className="text-[10px] font-mono border-b border-white/5 py-1">
                <div className="text-gold/90">{h.path}</div>
                <div className="muted truncate">{h.url}</div>
                {h.grudgeUUID && <div className="text-emerald-400/80">{h.grudgeUUID}</div>}
                <div className="muted">{h.reason} · score {h.score}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
