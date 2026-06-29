/** Dev portal worker kinds — orchestrator dispatches to these. */
export type DevWorker =
  | "legion"
  | "terminal"
  | "npm"
  | "node"
  | "vscode"
  | "webgl"
  | "coder"
  | "forge"
  | "pod";

export interface OrchestratorStep {
  worker: DevWorker;
  action: string;
  detail: string;
  command?: string;
  auto?: boolean;
}

export interface LocalPod {
  id: string;
  name: string;
  kind: "coder" | "node" | "ollama" | "vite" | "forge";
  status: "running" | "stopped" | "error";
  url?: string;
  pid?: number | null;
  port?: number;
  projectDir?: string | null;
}

/** Allow-listed terminal/npm prefixes (safety). */
export const ALLOWED_CMD_PREFIXES = [
  "npm ",
  "npx ",
  "node ",
  "pnpm ",
  "git ",
  "grudge-dev ",
  "wrangler ",
  "vite ",
  "tsc ",
  "echo ",
  "dir",
  "ls",
  "pwd",
  "cd ",
];

export function isAllowedDevCommand(cmd: string): boolean {
  const c = cmd.trim().toLowerCase();
  if (!c) return false;
  return ALLOWED_CMD_PREFIXES.some((p) => c.startsWith(p.trim().toLowerCase()));
}