/**
 * Forge AI helpers — texture suggestions + structured scene edits via
 * Workers AI / Legion hub / Ollama (window.grudge.ai · ollama).
 */

import * as THREE from "three";

export interface AiMaterialSuggestion {
  colorHex: number;
  metalness: number;
  roughness: number;
  emissiveHex?: number;
  searchTerms: string[];
  notes?: string;
}

export interface AiEditCommand {
  op:
    | "fill"
    | "metalness"
    | "roughness"
    | "ground"
    | "scale"
    | "rotate_y"
    | "offset"
    | "frame"
    | "note";
  value?: number | string | [number, number, number];
  colorHex?: number;
}

export interface AiEditPlan {
  summary: string;
  commands: AiEditCommand[];
}

function collectMaterialContext(root: THREE.Object3D): string {
  const lines: string[] = [];
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      const name = std?.name || mesh.name || "unnamed";
      const color = std?.color?.getHexString?.() ?? "?";
      lines.push(
        `mesh=${mesh.name || "mesh"} mat=${name} color=#${color} metal=${std?.metalness ?? "?"} rough=${std?.roughness ?? "?"}`,
      );
    }
  });
  return lines.slice(0, 40).join("\n");
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("AI response was not valid JSON");
}

async function aiChat(
  system: string,
  user: string,
): Promise<{ text: string; via: string }> {
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  // 1) Unified in-app agent (Ollama → Workers AI → Legion) — main process
  try {
    if (window.grudge?.agent?.chat) {
      const r = await window.grudge.agent.chat({ messages });
      const text = r?.text ?? r?.response ?? "";
      if (text) return { text: String(text), via: r?.source ?? "agent" };
    }
  } catch {
    /* continue */
  }

  // 2) fleet:aiChat
  try {
    const r = await window.grudge.fleet.aiChat({
      messages,
      max_tokens: 700,
      temperature: 0.35,
    });
    if (r?.text) return { text: String(r.text), via: `fleet:${r.provider ?? "ai"}` };
  } catch {
    /* continue */
  }

  // 3) Direct ollama IPC
  try {
    await window.grudge.ollama?.ensure?.({ agentic: false, reason: "forge-ai" });
    const r = await window.grudge.ollama.chat({ messages });
    const text = r?.message?.content ?? r?.response ?? "";
    if (text) return { text: String(text), via: "ollama" };
  } catch {
    /* continue */
  }

  // 4) Legion (now has local fallback inside main)
  const r = await window.grudge.legion.chat({
    messages,
    role: "dev",
  });
  return { text: String(r?.response ?? ""), via: r?.source ?? "legion" };
}

function parseHex(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v >>> 0;
  if (typeof v === "string") {
    const s = v.trim().replace(/^#/, "");
    const n = parseInt(s, 16);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

/** Suggest PBR material + texture search keywords for the selected asset. */
export async function aiSuggestTextures(
  root: THREE.Object3D,
  assetName: string,
): Promise<{ suggestion: AiMaterialSuggestion; via: string; raw: string }> {
  const ctx = collectMaterialContext(root);
  const system = `You are a game art assistant for Grudge Studio Forge.
Return ONLY compact JSON (no markdown) with:
{
  "colorHex": 16777215,
  "metalness": 0.0,
  "roughness": 0.7,
  "emissiveHex": 0,
  "searchTerms": ["keyword1","keyword2"],
  "notes": "short note"
}
colorHex is a decimal 0-16777215. searchTerms help find albedo/normal maps on CDN.`;

  const user = `Asset: ${assetName}
Materials:
${ctx || "(no materials — invent a sensible fantasy/RTS prop look)"}

Suggest base color + PBR + 4-8 texture search terms.`;

  const { text, via } = await aiChat(system, user);
  const obj = extractJsonObject(text) as Record<string, unknown>;
  const suggestion: AiMaterialSuggestion = {
    colorHex: parseHex(obj.colorHex, 0xb0b8c8),
    metalness: Math.min(1, Math.max(0, Number(obj.metalness) || 0.1)),
    roughness: Math.min(1, Math.max(0, Number(obj.roughness) || 0.75)),
    emissiveHex: obj.emissiveHex != null ? parseHex(obj.emissiveHex, 0) : 0,
    searchTerms: Array.isArray(obj.searchTerms)
      ? (obj.searchTerms as unknown[]).map(String).slice(0, 12)
      : [assetName.replace(/\.[^.]+$/, "")],
    notes: obj.notes != null ? String(obj.notes) : undefined,
  };
  return { suggestion, via, raw: text };
}

/** Plan structured edits from a natural-language instruction. */
export async function aiPlanEdit(
  root: THREE.Object3D,
  assetName: string,
  instruction: string,
): Promise<{ plan: AiEditPlan; via: string; raw: string }> {
  const ctx = collectMaterialContext(root);
  const system = `You are a Grudge Studio Forge editor AI.
Return ONLY JSON (no markdown):
{
  "summary": "one line",
  "commands": [
    { "op": "fill", "colorHex": 16766720 },
    { "op": "metalness", "value": 0.8 },
    { "op": "roughness", "value": 0.3 },
    { "op": "ground" },
    { "op": "scale", "value": 1.2 },
    { "op": "rotate_y", "value": 45 },
    { "op": "offset", "value": [0.5, 0, 0] },
    { "op": "frame" },
    { "op": "note", "value": "text" }
  ]
}
Only use those ops. Keep 1-8 commands. Degrees for rotate_y.`;

  const user = `Asset: ${assetName}
Materials:
${ctx || "(empty)"}

User request: ${instruction}`;

  const { text, via } = await aiChat(system, user);
  const obj = extractJsonObject(text) as Record<string, unknown>;
  const commands = Array.isArray(obj.commands) ? (obj.commands as AiEditCommand[]) : [];
  return {
    plan: {
      summary: String(obj.summary ?? "AI edit"),
      commands: commands.filter((c) => c && typeof c.op === "string"),
    },
    via,
    raw: text,
  };
}

/** Apply material fields onto every MeshStandardMaterial under root. */
export function applyMaterialSuggestion(
  root: THREE.Object3D,
  s: AiMaterialSuggestion,
): number {
  let count = 0;
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std?.isMeshStandardMaterial) continue;
      std.color.setHex(s.colorHex);
      std.metalness = s.metalness;
      std.roughness = s.roughness;
      if (s.emissiveHex) {
        std.emissive.setHex(s.emissiveHex);
        std.emissiveIntensity = Math.max(std.emissiveIntensity, 0.4);
      }
      std.needsUpdate = true;
      count++;
    }
  });
  return count;
}
