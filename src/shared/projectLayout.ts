/**
 * Grudge Studio — canonical on-disk project layout.
 *
 * Every game / scene pack / tool project should use this tree so agents,
 * Forge, Coder, and humans share one mental model. Paths are POSIX-style
 * relative to the project root (folder that contains `grudge.project.json`).
 *
 * Save practices:
 *   1. Always write through `grudge.project.json` (manifest is SSOT).
 *   2. Scenes/scripts go under typed folders — never dump GLBs at root.
 *   3. Prefer CDN keys + Grudge UUIDs in manifests over copied binaries.
 *   4. Local crash mirrors live only under `.grudge/drafts/`.
 *   5. Agents may auto-fix layout gaps; never invent asset URLs.
 */

export const PROJECT_MANIFEST = "grudge.project.json";
export const PROJECT_SCHEMA_VERSION = 1 as const;

/** Typed directories every scaffolded project gets. */
export const PROJECT_DIRS = [
  "scenes",
  "prefabs",
  "scripts",
  "assets/models",
  "assets/textures",
  "assets/audio",
  "assets/vfx",
  "assets/ui",
  "content",
  "builds",
  ".grudge/drafts",
  ".grudge/cache",
  ".grudge/diagnostics",
] as const;

export type ProjectDir = (typeof PROJECT_DIRS)[number];

export type ProjectKind = "game" | "scene-pack" | "tool" | "rts" | "rpg" | "sandbox";

export interface ProjectAssetRef {
  /** Stable Grudge UUID when known */
  grudgeUUID?: string | null;
  /** R2 object key (preferred identity) */
  path: string;
  /** Public CDN URL */
  url: string;
  role?: "character" | "prop" | "vfx" | "audio" | "texture" | "map" | "other";
  note?: string;
}

export interface ProjectSceneRef {
  id: string;
  name: string;
  /** Relative path under project root, e.g. scenes/main.json */
  file: string;
  template?: string | null;
}

export interface ProjectScriptRef {
  id: string;
  name: string;
  file: string;
  language: "typescript" | "javascript";
}

export interface GrudgeProjectManifest {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  name: string;
  kind: ProjectKind;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Preferred race kits / CDN roots for agents */
  preferredAssets: ProjectAssetRef[];
  scenes: ProjectSceneRef[];
  scripts: ProjectScriptRef[];
  /** Optional link to cloud Forge project id */
  forgeProjectId?: number | null;
  tags?: string[];
  /** Agent notes last written by auto-fix / diagnose */
  agentNotes?: string[];
}

/** Human-readable tree for docs and AI system prompts. */
export const PROJECT_TREE_DOC = `
project-root/
  grudge.project.json     # SSOT manifest (schema v${PROJECT_SCHEMA_VERSION})
  scenes/                 # scene JSON / forge scene exports
  prefabs/                # reusable entity packs
  scripts/                # TypeScript/JS gameplay scripts
  assets/
    models/               # local GLB/FBX (prefer CDN refs in manifest)
    textures/
    audio/
    vfx/
    ui/
  content/                # design docs, lore, quests
  builds/                 # packaged playable outputs
  .grudge/
    drafts/               # crash-safe local mirrors (do not ship)
    cache/                # agent/tool caches
    diagnostics/          # last diagnose/auto-fix reports
`.trim();

export function slugifyProjectName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "untitled-project";
}

export function defaultPreferredAssets(): ProjectAssetRef[] {
  const CDN = "https://assets.grudge-studio.com";
  return [
    {
      path: "models/grudge6/races/WK_Characters.glb",
      url: `${CDN}/models/grudge6/races/WK_Characters.glb`,
      role: "character",
      note: "Human Grudge6 race kit (child-mesh equip)",
    },
    {
      path: "models/grudge6/races/ORC_Characters.glb",
      url: `${CDN}/models/grudge6/races/ORC_Characters.glb`,
      role: "character",
      note: "Orc Grudge6 race kit",
    },
    {
      path: "models/vehicles/mounts/human/cavalry.glb",
      url: `${CDN}/models/vehicles/mounts/human/cavalry.glb`,
      role: "prop",
      note: "Human cavalry mount",
    },
    {
      path: "models/ummorpg-vehicles-catalog.json",
      url: `${CDN}/models/ummorpg-vehicles-catalog.json`,
      role: "other",
      note: "Vehicle catalog SSOT",
    },
  ];
}

export function starterSceneJson(name: string): object {
  return {
    version: 1,
    name,
    environment: {
      skyColor: "#87b5ff",
      fog: { type: "none" },
      gravity: [0, -9.81, 0],
      cameraMode: "editor",
    },
    entities: [
      {
        id: "ground",
        name: "Ground",
        type: "plane",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [40, 1, 40],
        physics: { bodyType: "fixed", colliders: [{ kind: "cuboid", halfExtents: [20, 0.05, 20] }] },
      },
      {
        id: "sun",
        name: "Sun",
        type: "light",
        position: [8, 16, 6],
        light: { kind: "directional", intensity: 1.2, color: "#fff5e0", castShadow: true },
      },
      {
        id: "player",
        name: "Player",
        type: "model",
        position: [0, 0, 0],
        model: {
          url: "https://assets.grudge-studio.com/models/grudge6/races/WK_Characters.glb",
          path: "models/grudge6/races/WK_Characters.glb",
        },
        controllerKind: "third-person",
        scale: [1, 1, 1],
      },
    ],
  };
}

export function starterScriptTs(name: string): string {
  return `/**
 * ${name} — Grudge Studio gameplay script
 * Patterns: validate before save; use ctx.scene APIs; attach via entity.scriptId
 */
export function onStart(ctx: any) {
  ctx.log?.info?.("${name} started");
}

export function onUpdate(ctx: any, dt: number) {
  // per-frame logic
}

export function onDestroy(ctx: any) {
  // cleanup
}
`;
}
