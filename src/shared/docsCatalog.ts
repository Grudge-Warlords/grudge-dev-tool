/**
 * Docs catalog — single source for in-app Docs tab and GitHub Pages nav.
 * Files live under repo `docs/` and publish via `.github/workflows/pages.yml`.
 */

export interface DocEntry {
  id: string;
  title: string;
  file: string;
  /** Jekyll permalink path under baseurl (no trailing slash issues) */
  pagesPath: string;
  description: string;
  group: "start" | "production" | "assets" | "tools" | "ai" | "systems";
  /** Prefer showing first in UI */
  primary?: boolean;
}

const PAGES_BASE = "https://grudge-warlords.github.io/grudge-dev-tool";

export function docsPagesUrl(pagesPath: string): string {
  if (pagesPath === "/" || pagesPath === "") return `${PAGES_BASE}/`;
  const p = pagesPath.startsWith("/") ? pagesPath : `/${pagesPath}`;
  return `${PAGES_BASE}${p}`;
}

export const DOCS_CATALOG: DocEntry[] = [
  {
    id: "home",
    title: "Home",
    file: "index.md",
    pagesPath: "/",
    description: "Product overview, install, ONE TRUTH first connection.",
    group: "start",
    primary: true,
  },
  {
    id: "quickstart",
    title: "Dev Tool quickstart",
    file: "dev-tool-quickstart.md",
    pagesPath: "/dev-tool-quickstart.html",
    description: "Install Forge tray, sign-in, Assets → Forge loop.",
    group: "start",
    primary: true,
  },
  {
    id: "one-truth",
    title: "ONE TRUTH wiring",
    file: "one-truth.md",
    pagesPath: "/one-truth.html",
    description: "client.grudge-studio.com API base; never api.grudge-studio.com.",
    group: "production",
    primary: true,
  },
  {
    id: "systems-api",
    title: "Systems & APIs",
    file: "systems-api.md",
    pagesPath: "/systems-api.html",
    description: "Canonical hosts, ObjectStore routes, Preview/Forge/Coder links.",
    group: "production",
    primary: true,
  },
  {
    id: "production-deployment",
    title: "Production deployment",
    file: "production-deployment.md",
    pagesPath: "/production-deployment.html",
    description: "Hosts, secrets, Pages, releases, AI workers.",
    group: "production",
    primary: true,
  },
  {
    id: "admin-architecture",
    title: "Admin architecture",
    file: "admin-architecture.md",
    pagesPath: "/admin-architecture.html",
    description: "Dev Tool tabs = production surfaces; Forge/Coder/Preview SSOT.",
    group: "production",
    primary: true,
  },
  {
    id: "production-config",
    title: "Production config / secrets",
    file: "production-config.md",
    pagesPath: "/production-config.html",
    description: "keytar secrets, env, CF credentials.",
    group: "production",
  },
  {
    id: "object-storage",
    title: "Object storage",
    file: "object-storage.md",
    pagesPath: "/object-storage.html",
    description: "R2 layout, manifests, CDN keys.",
    group: "assets",
    primary: true,
  },
  {
    id: "asset-loader",
    title: "Asset loader & materials",
    file: "asset-loader-materials.md",
    pagesPath: "/asset-loader-materials.html",
    description: "GLB load, materials, SI scale contracts.",
    group: "assets",
  },
  {
    id: "asset-packs",
    title: "Canonical asset packs",
    file: "asset-packs-canonical.md",
    pagesPath: "/asset-packs-canonical.html",
    description: "Warlords / grudge6 pack keys on CDN.",
    group: "assets",
  },
  {
    id: "ai-d1-r2",
    title: "AI Workers · D1 · R2 · Stream",
    file: "ai-workers-d1-r2-stream.md",
    pagesPath: "/ai-workers-d1-r2-stream.html",
    description: "Production AI + storage best practices.",
    group: "ai",
    primary: true,
  },
  {
    id: "scene-completion",
    title: "Scene Completion AI worker",
    file: "scene-completion-ai-worker.md",
    pagesPath: "/scene-completion-ai-worker.html",
    description: "Forge scene completion agent tools.",
    group: "ai",
  },
  {
    id: "skeleton",
    title: "Skeleton Studio",
    file: "skeleton-studio.md",
    pagesPath: "/skeleton-studio.html",
    description: "25-bone place, T-pose, retarget libraries.",
    group: "tools",
  },
  {
    id: "blender-mcp",
    title: "Blender MCP",
    file: "blender-mcp.md",
    pagesPath: "/blender-mcp.html",
    description: "Interactive Blender cleanup (not production bake SSOT).",
    group: "tools",
  },
  {
    id: "blenderkit",
    title: "BlenderKit use cases",
    file: "blenderkit-use-cases.md",
    pagesPath: "/blenderkit-use-cases.html",
    description: "Daemon search → convert → CDN path.",
    group: "tools",
  },
  {
    id: "uuid",
    title: "Grudge UUID",
    file: "grudge-uuid.md",
    pagesPath: "/grudge-uuid.html",
    description: "UUID format and slot system.",
    group: "systems",
  },
  {
    id: "cli",
    title: "CLI quickstart",
    file: "cli-quickstart.md",
    pagesPath: "/cli-quickstart.html",
    description: "grudge-dev doctor, upload-pack, setup.",
    group: "start",
  },
  {
    id: "api",
    title: "API reference",
    file: "api-reference.md",
    pagesPath: "/api-reference.html",
    description: "IPC + fleet API surface summary.",
    group: "systems",
  },
  {
    id: "grok-builder",
    title: "Grok Builder",
    file: "GROK_BUILDER.md",
    pagesPath: "/GROK_BUILDER.html",
    description: "Agentic Three.js + Rapier builder surface.",
    group: "tools",
  },
  {
    id: "forge-islands",
    title: "Forge island open scaffold",
    file: "FORGE_ISLAND_OPEN_SCAFFOLD.md",
    pagesPath: "/FORGE_ISLAND_OPEN_SCAFFOLD.html",
    description: "Open production island types in Forge / Dev Tool.",
    group: "tools",
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    file: "troubleshooting.md",
    pagesPath: "/troubleshooting.html",
    description: "Common failures: secrets, webview, R2, Ollama.",
    group: "start",
  },
];

export const DOCS_GROUP_LABELS: Record<DocEntry["group"], string> = {
  start: "Getting started",
  production: "Production & deploy",
  assets: "Assets & CDN",
  tools: "Editors & tools",
  ai: "AI & workers",
  systems: "Systems",
};
