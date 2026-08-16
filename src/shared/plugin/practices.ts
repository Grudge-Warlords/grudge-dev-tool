/**
 * Plugin practice catalog — dest-tool SSOT plus the high-value rules
 * reviewed from live Legion / Coder / Forge. Agents and the VS Code
 * extension consume this list; do not fork a second catalog.
 */

import {
  ALL_BEST_PRACTICES,
  type BestPractice,
} from "../bestPractices";
import type { PluginPractice, PluginPracticeSource } from "./contract";

const EXTRA: PluginPractice[] = [
  {
    id: "plugin-host",
    title: "Dev Tool is the local plugin host",
    source: "devtools",
    category: "surfaces",
    rule: "VS Code, standalone, viewer, and agentic attach to Grudge Dev Tool at 127.0.0.1:17380. Do not invent a second local admin app.",
  },
  {
    id: "forge-command-stack",
    title: "Forge edits go through the command stack",
    source: "forge",
    category: "editor",
    rule: "forge.grudge-studio.com uses CommandStack for undo. AI turns must be undoable. SI metres, sRGB, meshopt GLB. In-editor export is convenience; production bake is grudge-convert → R2.",
  },
  {
    id: "forge-physics",
    title: "Rapier only in Forge",
    source: "forge",
    category: "editor",
    rule: "Forge physics is Rapier. No Cannon/Ammo/Babylon. Send 3D from Dev Tool via CDN URL, not a local blob, for production scenes.",
  },
  {
    id: "forge-parity",
    title: "three.js editor DNA",
    source: "forge",
    category: "editor",
    rule: "Hierarchy, inspector, viewport gizmos, multi-format load, .gfscene.json. Align with THREEJS_EDITOR_PARITY.md. Prefer pirate-islands CDN key for open-world mesh edit.",
  },
  {
    id: "coder-specialties",
    title: "Coder pipeline specialties",
    source: "coder",
    category: "ai",
    rule: "detectTaskSpecialty: code→codex, deploy→nano, create→opus, organize→gemini, gamedev→sonnet, general→nano. Coder skills teach patterns; production games still follow fleet CDN/auth SSOT.",
  },
  {
    id: "coder-handoff",
    title: "Coder ↔ Dev Tool handoff",
    source: "coder",
    category: "surfaces",
    rule: "Local PTY + bootstrap: ?workspace=&project=&bootstrap=1&from=grudge-dev-tool. Public host is CF Pages + api.vibe; self-host is Docker. Two AI names: Legion (fleet chat) ≠ Coder workers/ai-hub (job ingest).",
  },
  {
    id: "legion-one-brain",
    title: "Legion is the one public brain",
    source: "legion",
    category: "ai",
    rule: "ai.grudge-studio.com owns models + /v1/agents + /v1/skills + /v1/context. Forge free-ai is same-origin hands. Load /v1/context before inventing hosts. Do not enable a second Workers AI brain on Forge.",
  },
  {
    id: "legion-roles",
    title: "Legion role agents",
    source: "legion",
    category: "ai",
    rule: "POST /v1/agents/{role}/chat with Grudge JWT. Roles: dev, forge, coder, agentic, deploy, convert, grudge6, ui, ux, fleet, warlords, puter. Guest path is GRUDGE_AI_KEY on the edge, never VITE_*.",
  },
];

function fromDevtool(p: BestPractice): PluginPractice {
  return {
    id: p.id,
    title: p.title,
    rule: p.rule,
    source: "devtools",
    category: p.category,
  };
}

export function listPluginPractices(opts?: {
  source?: PluginPracticeSource;
  category?: string;
}): PluginPractice[] {
  const merged = [...ALL_BEST_PRACTICES.map(fromDevtool), ...EXTRA];
  return merged.filter((p) => {
    if (opts?.source && p.source !== opts.source) return false;
    if (opts?.category && p.category !== opts.category) return false;
    return true;
  });
}

/** Compact system fragment for plugin agent runs. */
export function pluginAgentPracticesPrompt(): string {
  const core = listPluginPractices().filter((p) =>
    [
      "one-truth",
      "player-state",
      "assets-cdn",
      "agentic-access",
      "ai-two-surfaces",
      "ai-model-routing",
      "pipeline-convert",
      "pipeline-forge",
      "surface-devtools",
      "surface-coder",
      "surface-forge",
      "plugin-host",
      "forge-command-stack",
      "forge-physics",
      "coder-specialties",
      "coder-handoff",
      "legion-one-brain",
      "legion-roles",
      "no-meshy",
      "character-scale",
    ].includes(p.id),
  );
  return [
    "You are the Grudge Studio plugin agent, hosted by Grudge Dev Tool.",
    "Follow these production practices (from live ai.* / coder.* / forge.*):",
    ...core.map((p) => `- [${p.source}/${p.category}] ${p.title}: ${p.rule}`),
    "",
    "Never invent a second bag/roster DB, second mixer, second physics engine, or Meshy/capsule hero.",
    "Prefer CDN keys on assets.grudge-studio.com. Player state = Railway only.",
  ].join("\n");
}
