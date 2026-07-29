/**
 * Agent / hub client — **in-app first**.
 * Remote ai.grudge-studio.com is optional; desktop agent IPC always works.
 */

import { FLEET_URLS } from "../../shared/fleet";

const HUB = FLEET_URLS.ai.replace(/\/$/, "");

export interface GrudaProject {
  id: string;
  owner_id: string;
  owner_grudge_id?: string | null;
  name: string;
  slug: string;
  visibility: "private" | "team" | "public";
  description?: string | null;
  template?: string;
  storage_path?: string;
  github_repo?: string | null;
  created_at: string;
  updated_at: string;
}

async function hubAuthHeaders(): Promise<Record<string, string>> {
  const token = await window.grudge.auth.getPuterToken();
  if (!token) throw new Error("Sign in to Grudge first");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export type AgentBackend = "local" | "hub" | "offline";

export async function hubMe(): Promise<{
  userId: string;
  grudgeId?: string;
  username?: string;
  backend: AgentBackend;
}> {
  // Prefer signed-in session from desktop auth (no network)
  try {
    const session = await window.grudge.auth.getSession();
    if (session?.signedIn) {
      return {
        userId: session.puterUser?.uuid ?? session.grudgeId ?? "local",
        grudgeId: session.grudgeId ?? undefined,
        username: session.puterUser?.username ?? undefined,
        backend: "local",
      };
    }
  } catch {
    /* try hub */
  }

  try {
    const res = await fetch(`${HUB}/v1/auth/me`, {
      headers: await hubAuthHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const body = (await res.json()) as {
        user: { userId: string; grudgeId?: string; username?: string };
      };
      return { ...body.user, backend: "hub" };
    }
  } catch {
    /* offline */
  }

  return {
    userId: "local-guest",
    username: "local",
    backend: "offline",
  };
}

export async function listProjects(): Promise<GrudaProject[]> {
  try {
    const res = await fetch(`${HUB}/v1/projects`, {
      headers: await hubAuthHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { projects: GrudaProject[] };
    return body.projects ?? [];
  } catch {
    return [];
  }
}

export async function createProject(input: {
  name: string;
  description?: string;
  template?: string;
  visibility?: GrudaProject["visibility"];
}): Promise<GrudaProject> {
  try {
    const res = await fetch(`${HUB}/v1/projects`, {
      method: "POST",
      headers: await hubAuthHeaders(),
      body: JSON.stringify({ ...input, visibility: input.visibility ?? "private" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { project: GrudaProject };
      return body.project;
    }
  } catch {
    /* local stub */
  }
  // Local-only project record so UI keeps working offline
  const now = new Date().toISOString();
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "local";
  return {
    id: `local-${Date.now().toString(36)}`,
    owner_id: "local",
    name: input.name,
    slug,
    visibility: input.visibility ?? "private",
    description: input.description ?? "Local desktop project (hub offline)",
    template: input.template,
    created_at: now,
    updated_at: now,
  };
}

export async function updateProjectVisibility(
  id: string,
  visibility: GrudaProject["visibility"],
): Promise<GrudaProject> {
  try {
    const res = await fetch(`${HUB}/v1/projects/${id}`, {
      method: "PATCH",
      headers: await hubAuthHeaders(),
      body: JSON.stringify({ visibility }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { project: GrudaProject };
      return body.project;
    }
  } catch {
    /* fall through */
  }
  throw new Error("Hub offline — visibility is cloud-only");
}

export async function runAgent(
  task: string,
  projectId?: string,
): Promise<{
  runId: string;
  response: string;
  steps: Array<{ step: number; action: string; detail?: string }>;
  source?: string;
}> {
  // 1) Always prefer in-app agent (Ollama / Workers AI) — no browser
  try {
    const local = await window.grudge.agent.run({ task, projectId, role: "dev" });
    if (local?.response) return local;
  } catch (e: unknown) {
    console.warn("[agent] local run failed", e);
  }

  // 2) Optional remote hub
  try {
    const res = await fetch(`${HUB}/v1/agent/run`, {
      method: "POST",
      headers: await hubAuthHeaders(),
      body: JSON.stringify({ task, projectId, role: "dev", maxSteps: 6 }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) {
      const body = await res.json();
      return { ...body, source: "hub" };
    }
  } catch {
    /* ignore */
  }

  throw new Error(
    "Agent AI failed. Ensure Ollama is running (Settings → GRUDACHAIN) or Workers AI credentials are set. Everything runs in-app — no browser required.",
  );
}

export interface OrchestratorPlanStep {
  step: number;
  worker: string;
  action: string;
  detail: string;
  command?: string;
  auto?: boolean;
}

export interface HubPod {
  id: string;
  user_id: string;
  project_id?: string | null;
  name: string;
  kind: string;
  url?: string | null;
  status: string;
  meta_json?: string;
  created_at: string;
  updated_at: string;
}

export interface OrchestratorResult {
  ok: boolean;
  runId: string;
  status: string;
  workers: Array<{ id: string; label: string; caps: string[] }>;
  plan: OrchestratorPlanStep[];
  summary: string;
  executeLocally: OrchestratorPlanStep[];
  message: string;
  source?: string;
}

export async function runOrchestrator(task: string, projectId?: string): Promise<OrchestratorResult> {
  // In-app first
  try {
    const local = await window.grudge.agent.orchestrate({ task, projectId });
    if (local?.plan) return { ...local, source: local.source ?? "local" };
  } catch (e: unknown) {
    console.warn("[agent] local orchestrate failed", e);
  }

  try {
    const res = await fetch(`${HUB}/v1/orchestrator/run`, {
      method: "POST",
      headers: await hubAuthHeaders(),
      body: JSON.stringify({ task, projectId }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) {
      const body = (await res.json()) as OrchestratorResult;
      return { ...body, source: "hub" };
    }
  } catch {
    /* ignore */
  }

  throw new Error("Orchestrator failed in-app and hub. Check Ollama / AI gateway in Settings.");
}

export async function listHubPods(): Promise<HubPod[]> {
  try {
    const res = await fetch(`${HUB}/v1/pods`, {
      headers: await hubAuthHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { pods: HubPod[] };
    return body.pods ?? [];
  } catch {
    return [];
  }
}

export async function createHubPod(input: {
  name: string;
  kind?: string;
  projectId?: string;
  url?: string;
  meta?: Record<string, unknown>;
}): Promise<HubPod> {
  try {
    const res = await fetch(`${HUB}/v1/pods`, {
      method: "POST",
      headers: await hubAuthHeaders(),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { pod: HubPod };
      return body.pod;
    }
  } catch {
    /* local */
  }
  const now = new Date().toISOString();
  return {
    id: `local-pod-${Date.now().toString(36)}`,
    user_id: "local",
    project_id: input.projectId,
    name: input.name,
    kind: input.kind ?? "node",
    url: input.url,
    status: "local",
    created_at: now,
    updated_at: now,
  };
}

/** Stay inside the desktop app — open Agent AI route (never external browser). */
export function openGrudaAgentWorkspace(_projectSlug?: string): void {
  void window.grudge?.app?.openRoute?.("/ai");
}

/** Ensure local AI stack (Ollama) is up for agentic work. */
export async function ensureLocalAgent(): Promise<{ ok: boolean; detail: string }> {
  try {
    const ens = await window.grudge.ollama.ensure({ agentic: true, reason: "agent-ui" });
    const st = await window.grudge.agent.status();
    const host = st?.ollama?.host ?? "http://127.0.0.1:11434";
    if (st?.ollama?.ok) {
      return {
        ok: true,
        detail: `Ollama ready · ${host} · ${st.ollama.models?.length ?? 0} models · ${ens?.backend ?? st.ollama.backend}`,
      };
    }
    return {
      ok: false,
      detail: `Ollama not ready (${host}). ${st?.ollama?.error ?? "Start Docker or install Ollama — cloud AI may still work."}`,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
