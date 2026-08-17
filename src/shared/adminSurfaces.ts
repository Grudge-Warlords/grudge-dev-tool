/**
 * Grudge Dev Tool — admin surface SSOT.
 *
 * Single map of tabs, production hosts, and how they wire into the fleet.
 * Keep aligned with:
 *   - src/shared/fleet.ts (FLEET_URLS)
 *   - forge.grudge-studio.com (same source as Forge tab webview)
 *   - docs/ (GitHub Pages + in-app Docs tab)
 *   - grudge-fleet / grudge-studio / forge-editor skills
 *
 * Pattern: Dev Tool is the desktop admin shell. Tabs either embed the live
 * production surface (webview) or run local agents that call the same APIs.
 */

import { FLEET_URLS } from "./fleet";

export type AdminSurfaceKind =
  | "embed-prod"
  | "local-tool"
  | "hybrid"
  | "docs"
  | "system";

export interface AdminSurface {
  id: string;
  /** App route in renderer */
  route: string;
  label: string;
  kind: AdminSurfaceKind;
  /** Production URL when kind is embed-prod or hybrid */
  prodUrl?: string;
  /** Secondary local route (e.g. /forge-local) */
  localRoute?: string;
  /** Fleet API / catalog hosts this surface must use */
  apis: string[];
  description: string;
  adminOnly?: boolean;
}

/** Canonical admin tool surfaces — order mirrors daily workflow. */
export const ADMIN_SURFACES: AdminSurface[] = [
  {
    id: "studio-hub",
    route: "/studio",
    label: "Home",
    kind: "system",
    apis: [FLEET_URLS.client, FLEET_URLS.gameData, FLEET_URLS.auth],
    description: "Command center: fleet health, featured games, ONE TRUTH probes.",
  },
  {
    id: "assets",
    route: "/browser",
    label: "Assets",
    kind: "hybrid",
    apis: [FLEET_URLS.assets, FLEET_URLS.objectStore, FLEET_URLS.info, FLEET_URLS.ai],
    description:
      "R2/ObjectStore browser + always-on-top Asset Viewer. Agent AI search (>query). Send 3D → Forge CDN URL.",
    adminOnly: true,
  },
  {
    id: "local-files",
    route: "/local",
    label: "Local Files",
    kind: "local-tool",
    apis: [FLEET_URLS.assets, FLEET_URLS.forge],
    description:
      "Elite open system: Explorer double-click / Open with → Asset Viewer for 3D, image, audio, video, text, PDF. Folder browser + pop-out. Forge is explicit only.",
  },
  {
    id: "forge",
    route: "/forge",
    label: "Forge",
    kind: "embed-prod",
    prodUrl: FLEET_URLS.forge,
    localRoute: "/forge-local",
    apis: [
      FLEET_URLS.forge,
      FLEET_URLS.assets,
      FLEET_URLS.objectStore,
      FLEET_URLS.pipeline,
      FLEET_URLS.ai,
    ],
    description:
      "Same source as https://forge.grudge-studio.com — R3F + Rapier + AI Worker scene editor. Local tools for pop-out / convert only.",
    adminOnly: true,
  },
  {
    id: "preview",
    route: "/preview",
    label: "Preview",
    kind: "hybrid",
    apis: [
      FLEET_URLS.open,
      FLEET_URLS.client,
      FLEET_URLS.grudox,
      FLEET_URLS.water,
      FLEET_URLS.forge,
      FLEET_URLS.warlords,
    ],
    description:
      "Play-mode webview: load fleet clients/games for testing. Deep-link from Forge publish / sceneId / glb.",
    adminOnly: true,
  },
  {
    id: "coder",
    route: "/coder",
    label: "Coder",
    kind: "hybrid",
    prodUrl: FLEET_URLS.coder,
    apis: [FLEET_URLS.coder, FLEET_URLS.ai, FLEET_URLS.client],
    description:
      "GrudgeChain Vibe IDE — production embed (coder.grudge-studio.com) + optional local PTY server for full FS/agent power.",
    adminOnly: true,
  },
  {
    id: "skeleton",
    route: "/skeleton",
    label: "Skeleton",
    kind: "local-tool",
    apis: [FLEET_URLS.assets, FLEET_URLS.objectStore, FLEET_URLS.ai],
    description:
      "Mixamo-like ~25-bone place → T-pose → retarget library → grudge-convert bake → R2/CDN.",
    adminOnly: true,
  },
  {
    id: "store",
    route: "/library",
    label: "Store",
    kind: "hybrid",
    apis: [FLEET_URLS.objectStore, FLEET_URLS.info, FLEET_URLS.assets],
    description: "Catalog packs / prefabs from ObjectStore + info.* JSON SSOT.",
  },
  {
    id: "blenderkit",
    route: "/blenderkit",
    label: "BlenderKit",
    kind: "local-tool",
    apis: [FLEET_URLS.assets, FLEET_URLS.pipeline],
    description:
      "BlenderKit search/download via local daemon → convert (grudge-convert) → ObjectStore. Not a production mesh SSOT.",
    adminOnly: true,
  },
  {
    id: "uuid",
    route: "/uuid",
    label: "UUID",
    kind: "system",
    apis: [FLEET_URLS.gameData, FLEET_URLS.client],
    description: "Grudge UUID generation / inspect — shared/grudgeUUID.ts SSOT.",
  },
  {
    id: "legion",
    route: "/legion",
    label: "Legion Chat",
    kind: "hybrid",
    prodUrl: FLEET_URLS.ai,
    apis: [FLEET_URLS.ai, FLEET_URLS.auth, FLEET_URLS.puterSpace],
    description:
      "Fleet Legion AI (ai.grudge-studio.com) — not Coder AI hub worker. Roles, chat, agent tools. Account cloud: /puter-space.",
    adminOnly: true,
  },
  {
    id: "agent-ai",
    route: "/ai",
    label: "Agent AI",
    kind: "local-tool",
    apis: [FLEET_URLS.ai, FLEET_URLS.ollama, FLEET_URLS.assets, FLEET_URLS.forge],
    description:
      "Make & deploy orchestrator + GRUDACHAIN Ollama. Uses same convert/CDN/Forge contracts as production.",
  },
  {
    id: "docs",
    route: "/docs",
    label: "Docs",
    kind: "docs",
    prodUrl: "https://grudge-warlords.github.io/grudge-dev-tool/",
    apis: [],
    description:
      "Same Markdown source as GitHub Pages (docs/). In-app reader + published site.",
  },
  {
    id: "games",
    route: "/games",
    label: "Games",
    kind: "hybrid",
    apis: [FLEET_URLS.open, FLEET_URLS.client, FLEET_URLS.grudox],
    description: "Fleet game catalog / play modes — Open, client, GRUDOX, Warlords.",
  },
  {
    id: "view",
    route: "/view",
    label: "View Mode",
    kind: "local-tool",
    apis: [FLEET_URLS.assets, FLEET_URLS.objectStore, FLEET_URLS.forge],
    description:
      "Universal asset review — image, audio, PSD, scene, GLB. Save, Forge, storage, AI define.",
    adminOnly: true,
  },
  {
    id: "ui",
    route: "/ui",
    label: "Create UI",
    kind: "embed-prod",
    prodUrl: FLEET_URLS.ui,
    apis: [FLEET_URLS.ui, FLEET_URLS.assets, FLEET_URLS.open, FLEET_URLS.forge],
    description:
      "ui.grudge-studio.com — HUD/menus/settings packs. Open hosts GRUDOX; Forge deploys 3D; UI is shared chrome.",
  },
];

/** Admin-critical fleet hosts for health strip + Preview presets. */
export const ADMIN_FLEET_HOSTS = [
  { id: "client", label: "Client (ONE TRUTH)", url: FLEET_URLS.client, group: "core" as const },
  { id: "auth", label: "Grudge ID", url: FLEET_URLS.auth, group: "core" as const },
  { id: "gameData", label: "Railway game-data", url: FLEET_URLS.gameData, group: "core" as const },
  { id: "identity", label: "Portal / ENGINE", url: FLEET_URLS.identityApi, group: "core" as const },
  { id: "assets", label: "CDN assets", url: FLEET_URLS.assets, group: "data" as const },
  { id: "objectstore", label: "ObjectStore", url: FLEET_URLS.objectStore, group: "data" as const },
  { id: "info", label: "info.* catalogs", url: FLEET_URLS.info, group: "data" as const },
  { id: "ai", label: "Legion AI", url: FLEET_URLS.ai, group: "ai" as const },
  { id: "forge", label: "Forge", url: FLEET_URLS.forge, group: "tools" as const },
  { id: "coder", label: "Coder", url: FLEET_URLS.coder, group: "tools" as const },
  { id: "pipeline", label: "Pipeline", url: FLEET_URLS.pipeline, group: "tools" as const },
  { id: "open", label: "Open launcher", url: FLEET_URLS.open, group: "games" as const },
  { id: "grudox", label: "GRUDOX", url: FLEET_URLS.grudox, group: "games" as const },
  { id: "multiverse", label: "Multiverse", url: FLEET_URLS.multiverse, group: "games" as const },
  {
    id: "multiverseRoom",
    label: "Multiverse Railway",
    url: FLEET_URLS.multiverseRoom,
    group: "games" as const,
  },
  { id: "water", label: "Water island", url: FLEET_URLS.water, group: "games" as const },
  { id: "warlords", label: "Warlords", url: FLEET_URLS.warlords, group: "games" as const },
  { id: "foundry", label: "Character Foundry", url: FLEET_URLS.characterFoundry, group: "games" as const },
  { id: "builder", label: "Grok Builder", url: FLEET_URLS.grokBuilder, group: "tools" as const },
  { id: "observatory", label: "Observatory", url: FLEET_URLS.observatory, group: "ops" as const },
] as const;

export type AdminFleetHost = (typeof ADMIN_FLEET_HOSTS)[number];

/** Build a Preview play URL for a client after Forge publish / test. */
export function buildPlayTestUrl(opts: {
  base: string;
  sceneId?: string;
  glb?: string;
  from?: string;
  mode?: "play" | "preview";
}): string {
  const u = new URL(opts.base);
  u.searchParams.set("from", opts.from ?? "grudge-dev-tool");
  u.searchParams.set("mode", opts.mode ?? "play");
  if (opts.sceneId) u.searchParams.set("sceneId", opts.sceneId);
  if (opts.glb) u.searchParams.set("glb", opts.glb);
  return u.toString();
}

/** Forge edit URL — same query contract as production web editor. */
export function buildForgeEditUrl(opts?: {
  era?: string;
  sceneId?: string;
  glb?: string;
  edit?: boolean;
}): string {
  const u = new URL(FLEET_URLS.forge);
  if (opts?.edit !== false) {
    u.searchParams.set("edit", "1");
    u.searchParams.set("mode", "edit");
  }
  u.searchParams.set("from", "grudge-dev-tool");
  if (opts?.era) u.searchParams.set("era", opts.era);
  if (opts?.sceneId) u.searchParams.set("sceneId", opts.sceneId);
  if (opts?.glb) u.searchParams.set("glb", opts.glb);
  return u.toString();
}
