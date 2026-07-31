/**
 * Open fleet games:
 *   - Primary: real Forge (forge.grudge-studio.com) for full edit + deploy
 *   - Secondary: local Forge 3D tools for sample mesh / pop-out placements
 */
import {
  getGameDeployment,
  getLiveGameDeployments,
  type GameDeploymentDefinition,
} from "../../../shared/gameDeployments";
import { FLEET_URLS } from "../../../shared/fleet";
import { writeMirror } from "../workspace";

const MODEL_RE = /\.(glb|gltf)$/i;

/** Open production Forge editor (primary). */
export async function openGameInForgeStudio(
  gameId: string,
  opts?: { external?: boolean },
): Promise<GameDeploymentDefinition> {
  const game = getGameDeployment(gameId);
  if (!game) throw new Error(`Unknown game deployment: ${gameId}`);

  const u = new URL(FLEET_URLS.forge || "https://forge.grudge-studio.com");
  u.searchParams.set("edit", "1");
  u.searchParams.set("mode", "edit");
  u.searchParams.set("from", "grudge-dev-tool");
  u.searchParams.set("gameId", gameId);
  if (game.playUrl) u.searchParams.set("playUrl", game.playUrl);

  if (opts?.external) {
    await window.grudge.os.openExternal(u.toString());
  } else {
    // Navigate primary Forge webview; seed URL via workspace mirror if needed
    writeMirror({ playModeId: game.playModeId });
    await window.grudge.app.openRoute("/forge");
    // Also open external so editor is always the real site if webview is restricted
    try {
      await window.grudge.os.openExternal(u.toString());
    } catch {
      /* webview-only ok */
    }
  }
  return game;
}

export async function openGamePlay(
  gameId: string,
  opts?: { external?: boolean },
): Promise<GameDeploymentDefinition> {
  const game = getGameDeployment(gameId);
  if (!game) throw new Error(`Unknown game deployment: ${gameId}`);

  writeMirror({ playModeId: game.playModeId });
  try {
    await window.grudge.workspace.patch({ playModeId: game.playModeId });
  } catch {
    /* offline mirror ok */
  }

  if (opts?.external) {
    await window.grudge.os.openExternal(game.playUrl);
  } else {
    await window.grudge.app.openRoute("/play");
  }
  return game;
}

/**
 * Secondary: list first model under game asset prefixes and open in local Forge tools
 * (pop-out / placements). Prefer openGameInForgeStudio for full edit + deploy.
 */
export async function openGameInForge3D(
  gameId: string,
  opts?: { localOnly?: boolean },
): Promise<{ game: GameDeploymentDefinition; key: string; url: string }> {
  // Default path: production Forge (primary)
  if (!opts?.localOnly) {
    const game = await openGameInForgeStudio(gameId);
    return { game, key: "", url: FLEET_URLS.forge };
  }

  const game = getGameDeployment(gameId);
  if (!game) throw new Error(`Unknown game deployment: ${gameId}`);

  const prefixes = game.assetPrefixes.length
    ? game.assetPrefixes
    : [game.deployPrefix];

  let foundKey: string | null = null;
  for (const prefix of prefixes) {
    try {
      const res = await window.grudge.os.list({
        prefix: prefix.replace(/^\/+/, ""),
        delimiter: "/",
        limit: 80,
      });
      const model = (res.items ?? []).find(
        (it: { name: string }) => MODEL_RE.test(it.name) && !it.name.endsWith("/"),
      );
      if (model?.name) {
        foundKey = model.name;
        break;
      }
    } catch {
      /* try next prefix */
    }
  }

  if (!foundKey) {
    await window.grudge.app.openRoute("/browser");
    throw new Error(
      `No GLB under ${prefixes.join(", ")} yet — opened Assets browser. Upload or pick a model, then Local tools.`,
    );
  }

  const url: string = await window.grudge.cf.r2PublicUrl(foundKey);
  await window.grudge.app.openRoute("/forge-local");
  await window.grudge.forge.openRemote(url);
  return { game, key: foundKey, url };
}

export function listForgeOpenableGames(): GameDeploymentDefinition[] {
  return getLiveGameDeployments();
}

// Re-export island open helpers so AI workspace / loaders share one import surface
export {
  openIslandInForgeStudio,
  openIslandInForge3D,
  openIslandPlay,
  listForgeOpenableIslands,
  applyIslandDeployTarget,
} from "./openIsland";

export function applyGameDeployTarget(gameId: string): {
  deployPrefix: string;
  storeCategoryId: string;
  displayName: string;
} {
  const game = getGameDeployment(gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);
  return {
    deployPrefix: game.deployPrefix,
    storeCategoryId: game.storeCategoryId,
    displayName: game.displayName,
  };
}
