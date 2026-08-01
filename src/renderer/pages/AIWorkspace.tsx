import React, { useCallback, useEffect, useState } from "react";
import {
  Bot, FolderGit2, Lock, Globe, Users, Plus, Sparkles,
  Terminal, Boxes, Code2, Hammer, Play, RefreshCw, ChevronRight, Cpu,
} from "lucide-react";
import { toast } from "sonner";
import {
  listProjects,
  createProject,
  updateProjectVisibility,
  runAgent,
  runOrchestrator,
  listHubPods,
  createHubPod,
  openGrudaAgentWorkspace,
  hubMe,
  ensureLocalAgent,
  type GrudaProject,
  type OrchestratorResult,
  type OrchestratorPlanStep,
  type HubPod,
  type AgentBackend,
} from "../lib/grudaHub";
import { executeOrchestratorStep } from "../lib/devPortalExec";
import type { LocalPod } from "../../shared/devPortal";
import { FLEET_URLS } from "../../shared/fleet";

type Tab = "projects" | "orchestrator" | "terminal" | "pods" | "deploy";

const VIS_ICON: Record<string, React.ReactNode> = {
  private: <Lock size={12} />,
  team: <Users size={12} />,
  public: <Globe size={12} />,
};

/** One-click agentic tasks for make / deploy against ONE TRUTH fleet */
const DEPLOY_PRESETS: Array<{ label: string; task: string }> = [
  {
    label: "Deploy GLB pack to R2",
    task:
      "Convert and optimize all GLB/FBX in the current workspace for web, then upload to assets.grudge-studio.com via objectstore upload-url. Report CDN paths.",
  },
  {
    label: "Publish hero to Warlords",
    task:
      "Package the selected character mesh + baked anims for grudge6 SI scale, verify feet/hips, upload to CDN, and patch Railway character model3d for the active account.",
  },
  {
    label: "Fleet health + doctor",
    task:
      "Run ONE TRUTH probes against client.grudge-studio.com, Railway game-data, id.grudge-studio.com, objectstore, and assets CDN. Summarize failures and fix env if possible.",
  },
  {
    label: "Seed production NPCs",
    task:
      "Using GrudgeBuilder factionHeroCampaign SSOT, verify grudachain has 27 production NPCs with campaign missions and report roster + cNFT escrow status.",
  },
  {
    label: "Forge scene → deploy",
    task:
      "Export the current Forge scene as production GLB, optimize for web, upload to R2 under scenes/, and return a deep link for forge.grudge-studio.com and client play.",
  },
  {
    label: "Make anything",
    task: "",
  },
];

const POD_STATUS_COLOR: Record<string, string> = {
  running: "text-green-400",
  stopped: "text-muted",
  error: "text-red-400",
};

export default function AIWorkspace() {
  // Legion fleet chat is folded into this surface (nav alias /legion → /ai)
  const [tab, setTab] = useState<Tab>("deploy");
  const [projects, setProjects] = useState<GrudaProject[]>([]);
  const [user, setUser] = useState<{
    userId: string;
    grudgeId?: string;
    username?: string;
    backend?: AgentBackend;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [agentTask, setAgentTask] = useState("");
  const [orchTask, setOrchTask] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentOut, setAgentOut] = useState<string | null>(null);
  const [orchResult, setOrchResult] = useState<OrchestratorResult | null>(null);
  const [stepLogs, setStepLogs] = useState<Record<number, string>>({});
  const [termCmd, setTermCmd] = useState("");
  const [termHistory, setTermHistory] = useState<Array<{ cmd: string; out: string; ok: boolean }>>([]);
  const [localPods, setLocalPods] = useState<LocalPod[]>([]);
  const [hubPods, setHubPods] = useState<HubPod[]>([]);
  const [workspaceDir, setWorkspaceDir] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Warm local AI (Ollama) — non-blocking for UI
      void ensureLocalAgent().then((r) => setAiStatus(r.detail));
      const [me, list, dir] = await Promise.all([
        hubMe(),
        listProjects(),
        window.grudge.dev.getWorkspaceDir(),
      ]);
      setUser(me);
      setProjects(list);
      setWorkspaceDir(dir);
    } catch (e: unknown) {
      setUser({ userId: "local", username: "local", backend: "offline" });
      setProjects([]);
      toast.message("Running in local Agent AI mode", {
        description: e instanceof Error ? e.message : "Hub optional — agent runs in-app",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPods = useCallback(async () => {
    try {
      const [local, hub] = await Promise.all([
        window.grudge.dev.listPods(),
        listHubPods().catch(() => [] as HubPod[]),
      ]);
      setLocalPods(local);
      setHubPods(hub);
    } catch (e: unknown) {
      toast.error("Pod refresh failed", { description: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (tab === "pods") void refreshPods();
  }, [tab, refreshPods]);

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
      void ensureLocalAgent();
      const res = await runAgent(task, selectedId ?? undefined);
      setAgentOut(
        [
          res.response,
          res.source ? `\n\n— via ${res.source}` : "",
        ].join(""),
      );
      toast.success("Agent run complete", {
        description: `${res.source ?? "in-app"} · ${res.runId.slice(0, 8)}…`,
      });
    } catch (e: unknown) {
      toast.error("Agent failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onOrchestratorRun() {
    const task = orchTask.trim();
    if (!task) return;
    setBusy(true);
    setStepLogs({});
    try {
      void ensureLocalAgent();
      const res = await runOrchestrator(task, selectedId ?? undefined);
      setOrchResult(res);
      toast.success("Orchestrator plan ready", {
        description: `${res.plan.length} steps · ${res.source ?? "in-app"}`,
      });
    } catch (e: unknown) {
      toast.error("Orchestrator failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onEnsureAi() {
    setBusy(true);
    try {
      const r = await ensureLocalAgent();
      setAiStatus(r.detail);
      if (r.ok) toast.success("Local AI ready", { description: r.detail });
      else toast.message("Local AI partial", { description: r.detail });
    } finally {
      setBusy(false);
    }
  }

  async function onExecuteAutoSteps() {
    if (!orchResult) return;
    setBusy(true);
    const logs: Record<number, string> = { ...stepLogs };
    for (const step of orchResult.executeLocally) {
      const r = await executeOrchestratorStep(step);
      logs[step.step] = r.output;
      setStepLogs({ ...logs });
      if (!r.ok) {
        toast.error(`Step ${step.step} failed`, { description: r.output.slice(0, 120) });
        break;
      }
    }
    toast.success("Auto steps executed");
    setBusy(false);
  }

  async function onExecuteStep(step: OrchestratorPlanStep) {
    setBusy(true);
    try {
      const r = await executeOrchestratorStep(step);
      setStepLogs((prev) => ({ ...prev, [step.step]: r.output }));
      if (r.ok) toast.success(`Step ${step.step} done`);
      else toast.error(`Step ${step.step} failed`, { description: r.output.slice(0, 120) });
    } finally {
      setBusy(false);
    }
  }

  async function onTerminalRun() {
    const cmd = termCmd.trim();
    if (!cmd) return;
    setBusy(true);
    try {
      const r = await window.grudge.dev.terminal(cmd);
      const out = [r.stdout, r.stderr].filter(Boolean).join("\n") || "(no output)";
      setTermHistory((prev) => [{ cmd, out, ok: r.ok }, ...prev].slice(0, 50));
      setTermCmd("");
      if (!r.ok) toast.error("Command failed");
    } catch (e: unknown) {
      toast.error("Terminal error", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onCreateHubPod() {
    setBusy(true);
    try {
      const pod = await createHubPod({
        name: `Dev Pod ${hubPods.length + 1}`,
        kind: "node",
        projectId: selectedId ?? undefined,
      });
      setHubPods((prev) => [pod, ...prev]);
      toast.success("Hub pod registered");
    } catch (e: unknown) {
      toast.error("Create pod failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const tabs: Array<{ id: Tab; label: string; Icon: React.ComponentType<{ size?: number | string }> }> = [
    { id: "deploy", label: "Make & Deploy", Icon: Hammer },
    { id: "orchestrator", label: "Orchestrator", Icon: Sparkles },
    { id: "terminal", label: "Terminal", Icon: Terminal },
    { id: "pods", label: "Pods", Icon: Boxes },
    { id: "projects", label: "Projects", Icon: FolderGit2 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Bot size={22} /> Agent AI · Make & Deploy
          </h1>
          <p className="page-sub">
            Free agentic cascade <strong className="text-gold">inside this app</strong>:
            Ollama → Puter (User-Pays) → env OpenAI/Anthropic/Gemini → Workers AI → Legion.
            Sign in with Puter for free AI. Secrets load from your environment automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn ghost text-xs" disabled={busy} onClick={() => void onEnsureAi()}>
            <Cpu size={14} /> Start local AI
          </button>
          <button
            type="button"
            className="btn ghost text-xs"
            onClick={() => void window.grudge?.app?.openRoute?.("/legion")}
            title="Fleet Legion chat (ai.grudge-studio.com)"
          >
            Legion chat
          </button>
          <button type="button" className="btn" onClick={() => openGrudaAgentWorkspace(selected?.slug)}>
            <Bot size={14} /> Focus Agent panel
          </button>
        </div>
      </div>

      <div className="card text-xs text-muted flex flex-wrap gap-2 items-center">
        <span>
          {user ? (
            <>
              Identity <span className="text-gold font-mono">{user.username ?? user.userId}</span>
              {user.grudgeId && <> · <span className="font-mono">{user.grudgeId}</span></>}
              {user.backend && <> · <span className="text-gold">{user.backend}</span></>}
            </>
          ) : (
            <span>Local agent mode</span>
          )}
        </span>
        <span className="font-mono text-[10px]">cwd: {workspaceDir || "—"}</span>
        {aiStatus && (
          <span className="w-full text-[10px] font-mono text-gold/90 mt-1">{aiStatus}</span>
        )}
      </div>

      <div className="flex gap-1 flex-wrap border-b border-line pb-1">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`btn ghost text-xs ${tab === id ? "border-gold text-gold" : ""}`}
            onClick={() => setTab(id)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button type="button" className="btn ghost text-xs" disabled={busy} onClick={() => void window.grudge.dev.openVsCode()}>
          <Code2 size={12} /> VS Code
        </button>
        <button type="button" className="btn ghost text-xs" disabled={busy} onClick={() => void window.grudge.dev.npmRun("dev")}>
          <Play size={12} /> npm run dev
        </button>
        <button type="button" className="btn ghost text-xs" disabled={busy} onClick={() => void window.grudge.dev.npmRun("build")}>
          npm build
        </button>
        <button type="button" className="btn ghost text-xs" disabled={busy} onClick={() => void window.grudge.coder.launch({})}>
          <Code2 size={12} /> Coder IDE
        </button>
        <button type="button" className="btn ghost text-xs" disabled={busy} onClick={() => void window.grudge.app.openRoute("/forge")}>
          <Hammer size={12} /> Forge 3D / WebGL
        </button>
      </div>

      {tab === "deploy" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card space-y-3">
            <h2 className="text-gold font-semibold flex items-center gap-2">
              <Hammer size={16} /> Make & deploy anything
            </h2>
            <p className="text-xs text-muted">
              Presets fill the agent task, then run against GRUDA + local toolchain. Use orchestrator for multi-step
              npm/forge/upload pipelines.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DEPLOY_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="btn ghost text-[11px] py-1"
                  onClick={() => {
                    if (p.task) {
                      setAgentTask(p.task);
                      setOrchTask(p.task);
                    }
                    setTab(p.task ? "orchestrator" : "orchestrator");
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <textarea
              className="w-full min-h-[100px] text-sm"
              placeholder="e.g. Bake this FBX pack to SI-scale GLB, upload to R2 models/warlords/…, register in D1, and open in Forge…"
              value={agentTask}
              onChange={(e) => {
                setAgentTask(e.target.value);
                setOrchTask(e.target.value);
              }}
            />
            <div className="flex gap-2">
              <button type="button" className="btn flex-1" disabled={busy} onClick={() => void onAgentRun()}>
                Run agent
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void onOrchestratorRun()}>
                Plan deploy
              </button>
            </div>
            {agentOut && (
              <pre className="text-[11px] whitespace-pre-wrap max-h-48 overflow-auto border border-line rounded p-2 bg-bg-2">
                {agentOut}
              </pre>
            )}
          </div>
          <div className="card text-xs space-y-2">
            <h3 className="text-sm text-ink font-semibold">Fleet deploy targets</h3>
            <ul className="space-y-1 text-muted font-mono text-[10px]">
              <li>Game data · {FLEET_URLS.gameData}</li>
              <li>Assets CDN · {FLEET_URLS.assets}</li>
              <li>ObjectStore · {FLEET_URLS.objectStore}</li>
              <li>Warlords · {FLEET_URLS.warlords}</li>
              <li>Forge · {FLEET_URLS.forge}</li>
              <li>Client · {FLEET_URLS.client}</li>
              <li>AI · {FLEET_URLS.ai}</li>
            </ul>
            <p className="text-muted">
              Workspace: <span className="font-mono text-ink">{workspaceDir || "—"}</span>
            </p>
            <div className="flex flex-wrap gap-1">
              <button type="button" className="btn ghost text-[10px]" onClick={() => void window.grudge.app.openRoute("/browser")}>
                Open Assets
              </button>
              <button type="button" className="btn ghost text-[10px]" onClick={() => void window.grudge.app.openRoute("/forge")}>
                Open Forge
              </button>
              <button type="button" className="btn ghost text-[10px]" onClick={() => void window.grudge.app.openRoute("/upload")}>
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "orchestrator" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
              <Sparkles size={16} /> Smart orchestrator
            </h2>
            <p className="text-xs text-muted mb-2">
              {selected ? `Project: "${selected.name}"` : "Workspace mode — no project selected."}
              {" "}Classifies npm, terminal, Node, VS Code, WebGL, Coder, Forge, and pods.
            </p>
            <textarea
              className="w-full min-h-[80px] text-sm mb-2"
              placeholder="e.g. npm install and build, open in vscode, preview webgl scene…"
              value={orchTask}
              onChange={(e) => setOrchTask(e.target.value)}
            />
            <div className="flex gap-2">
              <button type="button" className="btn flex-1" disabled={busy} onClick={() => void onOrchestratorRun()}>
                Plan with orchestrator
              </button>
              {orchResult && orchResult.executeLocally.length > 0 && (
                <button type="button" className="btn" disabled={busy} onClick={() => void onExecuteAutoSteps()}>
                  Run auto steps
                </button>
              )}
            </div>

            <div className="mt-4 border-t border-line pt-3">
              <h3 className="text-xs text-gold mb-2">Legacy agent (chat plan)</h3>
              <textarea
                className="w-full min-h-[60px] text-sm mb-2"
                placeholder="Describe what the agent should plan or build…"
                value={agentTask}
                onChange={(e) => setAgentTask(e.target.value)}
              />
              <button type="button" className="btn w-full ghost" disabled={busy} onClick={() => void onAgentRun()}>
                Run GRUDA Agent
              </button>
              {agentOut && (
                <pre className="mt-2 text-[10px] max-h-32 overflow-auto bg-bg-2 p-2 rounded whitespace-pre-wrap font-mono">
                  {agentOut}
                </pre>
              )}
            </div>
          </div>

          <div className="card">
            <h2 className="text-gold font-semibold mb-3">Execution plan</h2>
            {!orchResult ? (
              <p className="text-muted text-sm">Run the orchestrator to see worker steps.</p>
            ) : (
              <>
                <pre className="text-[10px] max-h-28 overflow-auto bg-bg-2 p-2 rounded whitespace-pre-wrap font-mono mb-3">
                  {orchResult.summary}
                </pre>
                <ul className="space-y-2 max-h-80 overflow-auto">
                  {orchResult.plan.map((step) => (
                    <li key={step.step} className="border border-line rounded p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          <span className="text-gold font-mono">{step.step}.</span>{" "}
                          <span className="font-semibold">[{step.worker}]</span> {step.action}
                          {step.auto && <span className="text-muted ml-1">(auto)</span>}
                        </span>
                        <button
                          type="button"
                          className="btn ghost text-[10px] py-0 px-2"
                          disabled={busy}
                          onClick={() => void onExecuteStep(step)}
                        >
                          <ChevronRight size={10} /> Run
                        </button>
                      </div>
                      <div className="text-muted mt-1">{step.detail}</div>
                      {step.command && <div className="font-mono text-[10px] mt-1">{step.command}</div>}
                      {stepLogs[step.step] && (
                        <pre className="mt-2 text-[10px] bg-bg-2 p-1 rounded max-h-24 overflow-auto whitespace-pre-wrap">
                          {stepLogs[step.step]}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "terminal" && (
        <div className="card">
          <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
            <Terminal size={16} /> Local terminal
          </h2>
          <p className="text-xs text-muted mb-2">
            Allow-listed: npm, npx, node, pnpm, git, grudge-dev, wrangler, vite, tsc. cwd: {workspaceDir}
          </p>
          <div className="flex gap-2 mb-3">
            <input
              className="flex-1 font-mono text-sm"
              placeholder="npm run build"
              value={termCmd}
              onChange={(e) => setTermCmd(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void onTerminalRun(); }}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => void onTerminalRun()}>
              Run
            </button>
          </div>
          <div className="max-h-96 overflow-auto space-y-2">
            {termHistory.length === 0 ? (
              <p className="text-muted text-sm">No commands yet.</p>
            ) : termHistory.map((h, i) => (
              <div key={i} className="border border-line rounded p-2">
                <div className={`font-mono text-xs ${h.ok ? "text-gold" : "text-red-400"}`}>$ {h.cmd}</div>
                <pre className="text-[10px] mt-1 whitespace-pre-wrap font-mono text-muted">{h.out}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "pods" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-gold font-semibold flex items-center gap-2">
                <Boxes size={16} /> Local pods
              </h2>
              <button type="button" className="btn ghost text-xs" onClick={() => void refreshPods()}>
                <RefreshCw size={12} /> Refresh
              </button>
            </div>
            <ul className="space-y-2">
              {localPods.map((p) => (
                <li key={p.id} className="border border-line rounded p-2 text-xs">
                  <div className="flex justify-between">
                    <span className="font-semibold">{p.name}</span>
                    <span className={POD_STATUS_COLOR[p.status] ?? "text-muted"}>{p.status}</span>
                  </div>
                  <div className="text-muted font-mono text-[10px]">{p.kind}{p.port ? ` :${p.port}` : ""}</div>
                  {p.url && (
                    <button type="button" className="text-gold text-[10px] mt-1" onClick={() => void window.grudge.os.openExternal(p.url!)}>
                      {p.url}
                    </button>
                  )}
                  {p.kind === "coder" && p.status !== "running" && (
                    <button type="button" className="btn ghost text-[10px] mt-2" onClick={() => void window.grudge.coder.launch({})}>
                      Launch
                    </button>
                  )}
                  {p.kind === "forge" && (
                    <button type="button" className="btn ghost text-[10px] mt-2" onClick={() => void window.grudge.app.openRoute("/forge")}>
                      Open Forge 3D
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-gold font-semibold">Hub pods (cloud registry)</h2>
              <button type="button" className="btn ghost text-xs" disabled={busy} onClick={() => void onCreateHubPod()}>
                <Plus size={12} /> Register
              </button>
            </div>
            {hubPods.length === 0 ? (
              <p className="text-muted text-sm">No hub pods — register one to track remote dev environments.</p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-auto">
                {hubPods.map((p) => (
                  <li key={p.id} className="border border-line rounded p-2 text-xs">
                    <div className="flex justify-between">
                      <span className="font-semibold">{p.name}</span>
                      <span className={POD_STATUS_COLOR[p.status] ?? "text-muted"}>{p.status}</span>
                    </div>
                    <div className="text-muted font-mono text-[10px]">{p.kind} · {p.id.slice(0, 8)}…</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "projects" && (
        <div className="card max-w-2xl">
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
          <p className="text-[10px] text-muted mb-2">New projects are <strong>private</strong> by default.</p>

          {loading ? (
            <p className="text-muted text-sm">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="text-muted text-sm">No projects yet.</p>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-auto">
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
      )}
    </div>
  );
}