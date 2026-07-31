/**
 * Open home / event / boss / faction / lobby islands in:
 *   1) Production Forge (forge.grudge-studio.com) — primary edit + deploy
 *   2) Local Forge 3D tools — load primaryMesh via openRemote
 *   3) Live play URL — browser / Play Modes
 */
import {
  buildForgeIslandUrl,
  getIslandDeployment,
  listOpenableIslands,
  type IslandDeploymentDefinition,
} from "../../../shared/islandDeployments";
import { writeMirror } from "../workspace";

const MODEL_RE = /\.(glb|gltf)$/i;

function firstGlbUrl(island: IslandDeploymentDefinition): string | null {
  if (island.primaryMesh && MODEL_RE.test(island.primaryMesh)) return island.primaryMesh;
  const hit = island.meshUrls.find((u) => MODEL_RE.test(u) && !u.endsWith("/"));
  return hit ?? null;
}

/** Production Forge deep-link with island query + mesh. */
export async function openIslandInForgeStudio(
  islandId: string,
  opts?: { external?: boolean },
): Promise<IslandDeploymentDefinition> {
  const island = getIslandDeployment(islandId);
  if (!island) throw new Error(`Unknown island deployment: ${islandId}`);

  const url = buildForgeIslandUrl(island);
  writeMirror({ playModeId: `island:${island.id}` });

  if (opts?.external !== false) {
    await window.grudge.os.openExternal(url);
  }
  try {
    await window.grudge.app.openRoute("/forge");
  } catch {
    /* webview route optional */
  }
  return island;
}

/** Live play surface for the island. */
export async function openIslandPlay(
  islandId: string,
  opts?: { external?: boolean },
): Promise<IslandDeploymentDefinition> {
  const island = getIslandDeployment(islandId);
  if (!island) throw new Error(`Unknown island deployment: ${islandId}`);

  writeMirror({ playModeId: `island:${island.id}` });
  if (opts?.external !== false) {
    await window.grudge.os.openExternal(island.playUrl);
  } else {
    await window.grudge.app.openRoute("/play");
  }
  return island;
}

/**
 * Local Forge tools: download/open primaryMesh via forge.openRemote.
 * Falls back to listing R2 under deployPrefix if primary mesh missing.
 */
export async function openIslandInForge3D(
  islandId: string,
  opts?: { studioFirst?: boolean },
): Promise<{ island: IslandDeploymentDefinition; url: string; mode: "studio" | "local" }> {
  const island = getIslandDeployment(islandId);
  if (!island) throw new Error(`Unknown island deployment: ${islandId}`);

  // Default: production Forge first (full editor + Rapier + gfscene)
  if (opts?.studioFirst !== false) {
    await openIslandInForgeStudio(islandId, { external: true });
    return { island, url: buildForgeIslandUrl(island), mode: "studio" };
  }

  let meshUrl = firstGlbUrl(island);

  if (!meshUrl) {
    for (const prefix of island.assetPrefixes) {
      try {
        const res = await window.grudge.os.list({
          prefix: prefix.replace(/^\/+/, "").replace(/^https?:\/\/[^/]+\//, ""),
          delimiter: "/",
          limit: 40,
        });
        const model = (res.items ?? []).find(
          (it: { name: string }) => MODEL_RE.test(it.name) && !it.name.endsWith("/"),
        );
        if (model?.name) {
          meshUrl = await window.grudge.cf.r2PublicUrl(model.name);
          break;
        }
      } catch {
        /* next */
      }
    }
  }

  if (!meshUrl) {
    await window.grudge.app.openRoute("/browser");
    throw new Error(
      `No GLB for island ${islandId} — opened Assets browser. Check deployPrefix ${island.deployPrefix}.`,
    );
  }

  await window.grudge.app.openRoute("/forge-local");
  await window.grudge.forge.openRemote(meshUrl);
  return { island, url: meshUrl, mode: "local" };
}

export function listForgeOpenableIslands(): IslandDeploymentDefinition[] {
  return listOpenableIslands();
}

export function applyIslandDeployTarget(islandId: string): {
  deployPrefix: string;
  displayName: string;
  kind: string;
} {
  const island = getIslandDeployment(islandId);
  if (!island) throw new Error(`Unknown island: ${islandId}`);
  return {
    deployPrefix: island.deployPrefix,
    displayName: island.displayName,
    kind: island.kind,
  };
}
