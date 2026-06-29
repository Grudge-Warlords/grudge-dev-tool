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
  if (!token) throw new Error("Sign in to Grudge first (Settings → Identity)");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function hubMe(): Promise<{ userId: string; grudgeId?: string; username?: string }> {
  const res = await fetch(`${HUB}/v1/auth/me`, { headers: await hubAuthHeaders() });
  if (!res.ok) throw new Error(`Hub auth failed (${res.status})`);
  const body = await res.json() as { user: { userId: string; grudgeId?: string; username?: string } };
  return body.user;
}

export async function listProjects(): Promise<GrudaProject[]> {
  const res = await fetch(`${HUB}/v1/projects`, { headers: await hubAuthHeaders() });
  if (!res.ok) throw new Error(`List projects failed (${res.status})`);
  const body = await res.json() as { projects: GrudaProject[] };
  return body.projects ?? [];
}

export async function createProject(input: {
  name: string;
  description?: string;
  template?: string;
  visibility?: GrudaProject["visibility"];
}): Promise<GrudaProject> {
  const res = await fetch(`${HUB}/v1/projects`, {
    method: "POST",
    headers: await hubAuthHeaders(),
    body: JSON.stringify({ ...input, visibility: input.visibility ?? "private" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Create failed (${res.status})`);
  }
  const body = await res.json() as { project: GrudaProject };
  return body.project;
}

export async function updateProjectVisibility(
  id: string,
  visibility: GrudaProject["visibility"],
): Promise<GrudaProject> {
  const res = await fetch(`${HUB}/v1/projects/${id}`, {
    method: "PATCH",
    headers: await hubAuthHeaders(),
    body: JSON.stringify({ visibility }),
  });
  if (!res.ok) throw new Error(`Update failed (${res.status})`);
  const body = await res.json() as { project: GrudaProject };
  return body.project;
}

export async function runAgent(task: string, projectId?: string): Promise<{
  runId: string;
  response: string;
  steps: Array<{ step: number; action: string; detail?: string }>;
}> {
  const res = await fetch(`${HUB}/v1/agent/run`, {
    method: "POST",
    headers: await hubAuthHeaders(),
    body: JSON.stringify({ task, projectId, role: "dev", maxSteps: 6 }),
  });
  if (!res.ok) throw new Error(`Agent run failed (${res.status})`);
  return res.json();
}

export function openGrudaAgentWorkspace(projectSlug?: string): void {
  const base = HUB;
  const url = projectSlug ? `${base}/?project=${encodeURIComponent(projectSlug)}` : base;
  void window.grudge.os.openExternal(url);
}