/** Shared Coder URL + handoff types (main + renderer). */

export const CODER_CLOUD_URL = "https://coder.grudge-studio.com";
export const CODER_DEFAULT_PORT = 5111;

export type CoderMode = "local" | "cloud";

export interface CoderHandoff {
  projectId: string | null;
  workspace: string | null;
  url: string;
  mode: CoderMode;
  at: string;
}

export interface CoderLaunchResult {
  url: string;
  mode: CoderMode;
  port: number;
  error: string | null;
}

export function buildCoderUrl(
  base: string,
  opts: {
    workspace?: string;
    projectId?: string;
    bootstrap?: boolean;
    from?: string;
  },
): string {
  const u = new URL(base.endsWith("/") ? base : `${base}/`);
  if (opts.workspace) u.searchParams.set("workspace", opts.workspace);
  if (opts.projectId) u.searchParams.set("project", opts.projectId);
  if (opts.bootstrap) u.searchParams.set("bootstrap", "1");
  if (opts.from) u.searchParams.set("from", opts.from);
  return u.toString();
}