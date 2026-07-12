/**
 * Shared agent tool registry — used by GRUDA / Legion chat loops.
 * Tools are deterministic side-effectful operations (project OS, assets, fleet).
 */
import * as projects from "../projects";
import * as assetRegistry from "../assetRegistry";
import { r2List, r2PublicUrl } from "../cf/r2Direct";
import { fetchObjectStoreCatalog } from "../legion/orchestrator";
import { FLEET_GAMES } from "../../shared/fleetGames";
import { RACE_GRUDGE6, CDN_BASE } from "../../shared/grudge6Assets";
import { PROJECT_TREE_DOC } from "../../shared/projectLayout";

export const AGENT_SYSTEM_TOOLS = `
You are GRUDA — Grudge Studio agentic copilot. You fix projects autonomously when asked.

## Project save practices (always enforce)
1. Every project is a folder with \`grudge.project.json\` (SSOT).
2. Layout:
${PROJECT_TREE_DOC}
3. Prefer CDN keys + Grudge UUIDs over copying binaries into the repo.
4. Canonical characters: models/grudge6/races/*_Characters.glb (NOT toon-shooter).
5. Drafts only under .grudge/drafts/; never invent asset URLs — use tools.

## Tool protocol
Reply with ONE tool call as a single JSON object inside <tool>...</tool>, then wait.
After tool results, either call another tool or give a final concise answer.

Available tools:
- project_layout: {} — print canonical tree
- project_list: { "root"?: string }
- project_scaffold: { "name": string, "kind"?: "game"|"rts"|"rpg"|"sandbox"|"scene-pack"|"tool", "description"?: string }
- project_diagnose: { "dir": string }
- project_autofix: { "dir": string } — create folders, seed assets, restore missing scenes/scripts, move loose binaries
- project_open: { "dir": string } — open in Explorer
- asset_best: { "query": string, "limit"?: number } — best CDN/registry assets for a need
- asset_uuid: { "path": string } — path-stable Grudge UUID
- asset_verify: { "dir": string } — HEAD-check preferredAssets
- r2_list: { "prefix": string, "limit"?: number }
- r2_url: { "key": string }
- objectstore: { "path": string }
- fleet: {}
- race_kits: {} — list all Grudge6 race CDN URLs

When user says "fix my project", "organize folders", or "use best assets":
  project_diagnose → project_autofix → asset_best as needed → summarize what changed.
`.trim();

export type AgentToolName =
  | "project_layout"
  | "project_list"
  | "project_scaffold"
  | "project_diagnose"
  | "project_autofix"
  | "project_open"
  | "asset_best"
  | "asset_uuid"
  | "asset_verify"
  | "r2_list"
  | "r2_url"
  | "objectstore"
  | "fleet"
  | "race_kits";

export interface AgentToolCall {
  tool: AgentToolName;
  args?: Record<string, unknown>;
}

export function extractToolCall(text: string): AgentToolCall | null {
  const m = text.match(/<tool>\s*(\{[\s\S]*?\})\s*<\/tool>/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]) as AgentToolCall;
    if (parsed?.tool) return parsed;
  } catch { /* */ }
  return null;
}

export async function runAgentTool(call: AgentToolCall): Promise<string> {
  const args = call.args ?? {};
  switch (call.tool) {
    case "project_layout":
      return PROJECT_TREE_DOC;

    case "project_list":
      return JSON.stringify(projects.listProjects(args.root ? String(args.root) : undefined), null, 2);

    case "project_scaffold": {
      const name = String(args.name ?? "Untitled");
      const result = await projects.scaffoldProject({
        name,
        kind: (args.kind as any) || "game",
        description: args.description ? String(args.description) : undefined,
        parentDir: args.parentDir ? String(args.parentDir) : undefined,
      });
      return JSON.stringify({ dir: result.dir, id: result.manifest.id, name: result.manifest.name }, null, 2);
    }

    case "project_diagnose": {
      const dir = String(args.dir ?? "");
      if (!dir) return JSON.stringify({ error: "dir required" });
      return JSON.stringify(projects.diagnoseProject(dir), null, 2);
    }

    case "project_autofix": {
      const dir = String(args.dir ?? "");
      if (!dir) return JSON.stringify({ error: "dir required" });
      const r = await projects.autoFixProject(dir);
      return JSON.stringify({ fixed: r.fixed, remaining: r.remaining, name: r.manifest?.name }, null, 2);
    }

    case "project_open": {
      const dir = String(args.dir ?? "");
      if (!dir) return JSON.stringify({ error: "dir required" });
      projects.openInExplorer(dir);
      return JSON.stringify({ opened: dir });
    }

    case "asset_best": {
      const query = String(args.query ?? "character");
      const limit = Number(args.limit ?? 12);
      const hits = await projects.resolveBestAssets(query, limit);
      return JSON.stringify({ query, hits }, null, 2);
    }

    case "asset_uuid": {
      const path = String(args.path ?? "").replace(/^\//, "");
      const uuid = assetRegistry.uuidForAssetPath(path);
      const url = (await r2PublicUrl(path).catch(() => null)) || `${CDN_BASE}/${path}`;
      return JSON.stringify({ path, uuid, url });
    }

    case "asset_verify": {
      const dir = String(args.dir ?? "");
      if (!dir) return JSON.stringify({ error: "dir required" });
      return JSON.stringify(await projects.verifyPreferredAssets(dir), null, 2);
    }

    case "r2_list": {
      const prefix = String(args.prefix ?? "");
      const limit = Number(args.limit ?? 25);
      const list = await r2List({ prefix, limit, delimiter: "/" });
      return JSON.stringify({
        prefix: list.prefix,
        folders: list.folders?.slice(0, 15),
        items: list.items.slice(0, limit).map((i) => ({ name: i.name, size: i.size })),
      }, null, 2);
    }

    case "r2_url": {
      const key = String(args.key ?? "");
      const url = await r2PublicUrl(key);
      return JSON.stringify({ key, url, uuid: assetRegistry.uuidForAssetPath(key) });
    }

    case "objectstore": {
      const path = String(args.path ?? "/");
      const data = await fetchObjectStoreCatalog(path);
      return JSON.stringify(data).slice(0, 8000);
    }

    case "fleet":
      return JSON.stringify(
        FLEET_GAMES.slice(0, 40).map((g) => ({
          id: g.id,
          name: g.displayName,
          url: g.url,
          status: g.status,
        })),
        null,
        2,
      );

    case "race_kits":
      return JSON.stringify(
        Object.values(RACE_GRUDGE6).map((r) => ({
          race: r.modelId,
          label: r.label,
          path: r.cdnPath.replace(/^\//, ""),
          url: r.cdnUrl,
          uuid: assetRegistry.uuidForAssetPath(r.cdnPath.replace(/^\//, "")),
        })),
        null,
        2,
      );

    default:
      return JSON.stringify({ error: `unknown tool: ${(call as any).tool}` });
  }
}
