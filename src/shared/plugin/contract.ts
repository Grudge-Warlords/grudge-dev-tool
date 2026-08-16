/**
 * Grudge Studio plugin contract.
 *
 * One kernel, four form factors:
 *   - dest-tool (this app) = attached local host
 *   - VS Code extension    = packages/vscode-extension in GrudachainCode
 *   - standalone panel     = GET http://127.0.0.1:17380/
 *   - viewer + agentic     = same host routes
 *
 * Migrated from live: ai.grudge-studio.com · coder.grudge-studio.com · forge.grudge-studio.com
 * Do not invent a second brain, second bag DB, or second editor.
 */

export const PLUGIN_ID = "grudge-studio-plugin";
export const PLUGIN_NAME = "Grudge Studio Plugin";
export const PLUGIN_VERSION = "1.0.0";

/** Loopback-only attach port. Override with GRUDGE_PLUGIN_PORT. */
export const DEFAULT_PLUGIN_PORT = 17380;
export const PLUGIN_LOOPBACK = "127.0.0.1";

export const PLUGIN_TOKEN_DIR_NAME = "grudge-dev-tool";
export const PLUGIN_TOKEN_FILE = "plugin-token";

export type PluginSurface = "devtools" | "vscode" | "standalone" | "viewer" | "agentic";

export type PluginPracticeSource = "devtools" | "forge" | "coder" | "legion";

export const PLUGIN_FLEET = {
  ai: "https://ai.grudge-studio.com",
  coder: "https://coder.grudge-studio.com",
  forge: "https://forge.grudge-studio.com",
  client: "https://client.grudge-studio.com",
  assets: "https://assets.grudge-studio.com",
  objectStore: "https://objectstore.grudge-studio.com/api/v1",
  id: "https://id.grudge-studio.com",
} as const;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  host: "grudge-dev-tool";
  origin: string;
  port: number;
  surfaces: PluginSurface[];
  fleet: typeof PLUGIN_FLEET;
  endpoints: Record<string, string>;
}

export interface PluginHealth {
  ok: boolean;
  host: "grudge-dev-tool";
  plugin: string;
  version: string;
  origin: string;
  port: number;
  tokenRequired: boolean;
  agentic: {
    ready: boolean;
    ollama: boolean;
    cascade: string;
  };
  viewer: boolean;
  fleet: typeof PLUGIN_FLEET;
}

export interface PluginPractice {
  id: string;
  title: string;
  rule: string;
  source: PluginPracticeSource;
  category: string;
}

export interface PluginHostStatus {
  running: boolean;
  origin: string;
  port: number;
  tokenPath: string;
  discoverPath: string;
}

export interface PluginChatRequest {
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  task?: string;
  role?: string;
}

export interface PluginViewerOpenRequest {
  url?: string;
  localPath?: string;
  name?: string;
  contentType?: string;
}

export interface PluginOpenRequest {
  target: "forge" | "coder" | "ai" | "devtools" | "standalone";
}

export function pluginOrigin(port = DEFAULT_PLUGIN_PORT): string {
  return `http://${PLUGIN_LOOPBACK}:${port}`;
}

export function pluginManifest(port = DEFAULT_PLUGIN_PORT): PluginManifest {
  const origin = pluginOrigin(port);
  return {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    host: "grudge-dev-tool",
    origin,
    port,
    surfaces: ["devtools", "vscode", "standalone", "viewer", "agentic"],
    fleet: PLUGIN_FLEET,
    endpoints: {
      health: "/health",
      manifest: "/v1/manifest",
      practices: "/v1/practices",
      surfaces: "/v1/surfaces",
      agentChat: "/v1/agent/chat",
      agentRun: "/v1/agent/run",
      viewerOpen: "/v1/viewer/open",
      open: "/v1/open",
      standalone: "/",
    },
  };
}
