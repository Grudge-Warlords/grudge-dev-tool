import React, { useCallback, useEffect, useState } from "react";
import { Bot, FolderGit2, Lock, Globe, Users, ExternalLink, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  listProjects,
  createProject,
  updateProjectVisibility,
  runAgent,
  openGrudaAgentWorkspace,
  hubMe,
  type GrudaProject,
} from "../lib/grudaHub";
import { FLEET_URLS } from "../../shared/fleet";

const VIS_ICON: Record<string, React.ReactNode> = {
  private: <Lock size={12} />,
  team: <Users size={12} />,
  public: <Globe size={12} />,
};

export default function AIWorkspace() {
  const [projects, setProjects] = useState<GrudaProject[]>([]);
  const [user, setUser] = useState<{ userId: string; grudgeId?: string; username?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [agentTask, setAgentTask] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentOut, setAgentOut] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [me, list] = await Promise.all([hubMe(), listProjects()]);
      setUser(me);
      setProjects(list);
    } catch (e: unknown) {
      setUser(null);
      setProjects([]);
      toast.error("GRUDA Hub unavailable", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function onCreate() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const p = await createProject({ name, visibility: "private", template: "r3f-boilerplate" });
      setProjects((prev) => [p, ...prev]);
      setNewName("");
      toast.success(`Created private project "${p.name}"`);
    } catch (e: unknown) {
      toast.error("Create failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onVisibility(id: string, visibility: GrudaProject["visibility"]) {
    setBusy(true);
    try {
      const p = await updateProjectVisibility(id, visibility);
      setProjects((prev) => prev.map((x) => (x.id === id ? p : x)));
      toast.success(`Visibility → ${visibility}`);
    } catch (e: unknown) {
      toast.error("Update failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onAgentRun() {
    const task = agentTask.trim();
    if (!task) return;
    setBusy(true);
    try {
      const res = await runAgent(task, selectedId ?? undefined);
      setAgentOut(res.response);
      toast.success("Agent run complete", { description: `Run ${res.runId.slice(0, 8)}…` });
    } catch (e: unknown) {
      toast.error("Agent failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Bot size={22} /> GRUDA AI Workspace
          </h1>
          <p className="page-sub">
            GitHub-style project repos on{" "}
            <a href={FLEET_URLS.ai} className="text-gold" onClick={(e) => { e.preventDefault(); openGrudaAgentWorkspace(); }}>
              ai.grudge-studio.com
            </a>
            {" "}— private by default, share only when you change project settings.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => openGrudaAgentWorkspace(selected?.slug)}>
          <ExternalLink size={14} /> Open full GRUDA Agent
        </button>
      </div>

      {user && (
        <div className="card text-xs text-muted">
          Signed in as <span className="text-gold font-mono">{user.username ?? user.userId}</span>
          {user.grudgeId && <> · <span className="font-mono">{user.grudgeId}</span></>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
            <FolderGit2 size={16} /> Your projects
          </h2>
          <div className="flex gap-2 mb-3">
            <input
              className="flex-1"
              placeholder="New project name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void onCreate(); }}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => void onCreate()}>
              <Plus size={14} /> Create
            </button>
          </div>
          <p className="text-[10px] text-muted mb-2">New projects are <strong>private</strong> — only you see them until you invite or set visibility.</p>

          {loading ? (
            <p className="text-muted text-sm">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="text-muted text-sm">No projects yet. Create one like a new GitHub repo.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-auto">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className={`border border-line rounded p-2 cursor-pointer ${selectedId === p.id ? "border-gold bg-gold/5" : ""}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">{p.name}</span>
                    <span className="text-muted flex items-center gap-1 text-[10px]">
                      {VIS_ICON[p.visibility]} {p.visibility}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-muted">{p.slug}</div>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {(["private", "team", "public"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={`btn ghost text-[10px] py-0 px-2 ${p.visibility === v ? "border-gold" : ""}`}
                        disabled={busy || p.visibility === v}
                        onClick={(e) => { e.stopPropagation(); void onVisibility(p.id, v); }}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
            <Sparkles size={16} /> Agentic agent
          </h2>
          <p className="text-xs text-muted mb-2">
            {selected ? `Task context: project "${selected.name}"` : "No project selected — workspace-wide mode."}
          </p>
          <textarea
            className="w-full min-h-[80px] text-sm mb-2"
            placeholder="Describe what the agent should plan or build…"
            value={agentTask}
            onChange={(e) => setAgentTask(e.target.value)}
          />
          <button type="button" className="btn w-full" disabled={busy} onClick={() => void onAgentRun()}>
            Run GRUDA Agent
          </button>
          {agentOut && (
            <pre className="mt-3 text-[10px] max-h-48 overflow-auto bg-bg-2 p-2 rounded whitespace-pre-wrap font-mono">
              {agentOut}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}