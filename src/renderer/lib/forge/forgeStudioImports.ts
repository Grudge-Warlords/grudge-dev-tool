/**
 * Scaffold: improvements & imports from Grudge Studio Forge (production R3F editor)
 * into Grudge Dev Tool local Forge tools + open-island paths.
 *
 * Upstream SSOT: F:\GitHub\Grudge-Studio-Forge\Grudge-Studio-Forge
 * Live:          https://forge.grudge-studio.com
 *
 * Dev Tool already has a lighter vanilla three SceneEngine (Forge3D).
 * Production Forge has R3F + Rapier + .gfscene + templates + AI tools.
 * This module is the **bridge catalog** — what to open, what to port next, what to call remotely.
 */

export const FORGE_STUDIO_ROOT =
  "F:\\GitHub\\Grudge-Studio-Forge\\Grudge-Studio-Forge";

export const FORGE_STUDIO_LIVE = "https://forge.grudge-studio.com";

/** Paths under Forge monorepo (relative to FORGE_STUDIO_ROOT). */
export const FORGE_IMPORT_MAP = {
  fileKind: "artifacts/game-forge/src/lib/fileKind.ts",
  converters: "artifacts/game-forge/src/lib/converters.ts",
  zipImport: "artifacts/game-forge/src/lib/zipImport.ts",
  loadTemplate: "artifacts/game-forge/src/lib/loadTemplate.ts",
  sceneTemplates: "artifacts/game-forge/src/lib/sceneTemplates.ts",
  mapGen: "artifacts/game-forge/src/lib/mapGen.ts",
  proceduralTerrain: "artifacts/game-forge/src/lib/proceduralTerrain.ts",
  commands: "artifacts/game-forge/src/lib/commands.ts",
  bestPractices: "artifacts/game-forge/src/lib/bestPractices.ts",
  assetConverter: "artifacts/game-forge/src/lib/assetConverter.ts",
  forgeFromAsset: "artifacts/game-forge/src/lib/forgeFromAsset.ts",
  openModelTab: "artifacts/game-forge/src/lib/openModelTab.ts",
  sceneSchema: "lib/scene-schema/src/index.ts",
  sceneTemplatesLib: "lib/scene-templates/src/builders.ts",
  threejsAssetIoSkill: ".agents/skills/threejs-asset-io/SKILL.md",
  proceduralWorldSkill: ".agents/skills/procedural-world-generation/SKILL.md",
  rapierSkill: ".agents/skills/rapier-physics-patterns/SKILL.md",
} as const;

export type ForgeImportStatus = "ported" | "scaffold" | "remote_only" | "planned";

export interface ForgeImportItem {
  id: string;
  label: string;
  status: ForgeImportStatus;
  /** Upstream path (key of FORGE_IMPORT_MAP or free string) */
  upstream: string;
  /** Dev-tool local path if ported / scaffolded */
  local?: string;
  notes: string;
}

/**
 * Improvement scaffold — ordered by product value for islands + deploy.
 */
export const FORGE_IMPROVEMENT_SCAFFOLD: ForgeImportItem[] = [
  {
    id: "prod-loader",
    label: "ThreeFlow production GLTF loader (Draco + Meshopt + KTX2)",
    status: "ported",
    upstream: "F:\\GitHub\\ThreeFlow\\src\\utils\\gltfProdLoader.ts",
    local: "src/renderer/lib/forge/gltfProdLoader.ts",
    notes: "Elite / Forge3D / convertToGlb all call loadModel → this factory. No bare GLTFLoader.",
  },
  {
    id: "editor-handoff",
    label: "ThreeFlow + Forge live ?asset= handoff",
    status: "ported",
    upstream: "threeflow.vercel.app ?asset=",
    local: "src/shared/editorHandoff.ts",
    notes: "Elite Open in ThreeFlow / Forge live. ThreeFlow consumeDevToolAsset after init.",
  },
  {
    id: "file-kind",
    label: "fileKind classifier (glb/fbx/zip/gfscene)",
    status: "ported",
    upstream: FORGE_IMPORT_MAP.fileKind,
    local: "src/renderer/lib/forge/fileKind.ts",
    notes: "Drop-zone classification without pulling three.js converters.",
  },
  {
    id: "island-deployments",
    label: "Island deployment catalog (home/event/boss/faction/lobby)",
    status: "ported",
    upstream: "GrudgeBuilder shared/definitions/*Island*",
    local: "src/shared/islandDeployments.ts",
    notes: "Open targets for generator, pirate lobby, faction capitals, boss GLBs.",
  },
  {
    id: "open-island",
    label: "openIslandInForge / local mesh",
    status: "ported",
    upstream: "openModelTab + forge query params",
    local: "src/renderer/lib/forge/openIsland.ts",
    notes: "Deep-link production Forge or load primaryMesh in local tools.",
  },
  {
    id: "gfscene-import",
    label: ".gfscene.json import in local Forge3D",
    status: "scaffold",
    upstream: FORGE_IMPORT_MAP.sceneSchema,
    local: "src/renderer/lib/forge/sceneSerializer.ts (extend)",
    notes: "Parse entities[] like Forge Toolbar Import scene JSON.",
  },
  {
    id: "zip-import",
    label: "ZIP multi-asset import",
    status: "planned",
    upstream: FORGE_IMPORT_MAP.zipImport,
    notes: "Lazy port zipImport.ts — extract glb/fbx from packs into scene.",
  },
  {
    id: "template-stream",
    label: "Streaming template loader + progress",
    status: "remote_only",
    upstream: FORGE_IMPORT_MAP.loadTemplate,
    notes: "Keep on forge.grudge-studio.com; Dev Tool opens via forgeQuery.",
  },
  {
    id: "procedural-home",
    label: "Home island procedural terrain (mapGen / seed)",
    status: "scaffold",
    upstream: FORGE_IMPORT_MAP.proceduralTerrain,
    notes: "Home generator seed → heightfield; pair with homeIslandSeed SSOT.",
  },
  {
    id: "command-stack",
    label: "CommandStack undo (Forge commands.ts)",
    status: "scaffold",
    upstream: FORGE_IMPORT_MAP.commands,
    local: "src/renderer/lib/forge/history.ts",
    notes: "Dev Tool has TransformHistory; align API with Forge CommandStack.",
  },
  {
    id: "rapier-layers",
    label: "Rapier physics layers in local tools",
    status: "planned",
    upstream: FORGE_IMPORT_MAP.rapierSkill,
    notes: "Local Forge3D is visual-first; physics bake stays on production Forge.",
  },
  {
    id: "ai-tools",
    label: "Forge AI list_game_deployments + island open",
    status: "scaffold",
    upstream: "artifacts/game-forge/src/ai/*",
    notes: "Agentic deploy already uses gameDeployments; extend to islandDeployments.",
  },
];

export function listPortedForgeImports(): ForgeImportItem[] {
  return FORGE_IMPROVEMENT_SCAFFOLD.filter((i) => i.status === "ported");
}

export function listScaffoldForgeImports(): ForgeImportItem[] {
  return FORGE_IMPROVEMENT_SCAFFOLD.filter(
    (i) => i.status === "scaffold" || i.status === "planned",
  );
}

/** Build a production Forge URL that loads a CDN mesh (`?asset=` + `?mesh=`). */
export { forgeStudioAssetUrl as forgeStudioMeshUrl } from "../../../shared/editorHandoff";
export { threeflowAssetUrl, bestEditorUrl } from "../../../shared/editorHandoff";
