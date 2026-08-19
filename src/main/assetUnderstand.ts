/**
 * Asset understand — structured cards for AI agents + humans.
 * Classifies local (or named CDN) assets, attaches model inspect / image caption
 * when available, and returns markdown + JSON ready for Legion / Ollama / clipboard.
 *
 * Does NOT invent a second open path — elite viewer + mediaTypes remain SSOT for open.
 */

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import {
  inferContentType,
  isAudioPath,
  isImagePath,
  isModelPath,
  isStreamableMediaPath,
  isThreeScenePath,
  isVideoPath,
} from "../shared/mediaTypes";
import { mediaStreamUrl } from "./mediaProtocol";
import { inspectModel } from "./ingestion/modelInspect";
import { workersAiCaption } from "./cf/aiGateway";
import log from "./logger";

export type AssetKindCard =
  | "image"
  | "video"
  | "audio"
  | "model3d"
  | "scene3d"
  | "text"
  | "pdf"
  | "design"
  | "file";

export interface AssetUnderstandCard {
  ok: true;
  name: string;
  path: string | null;
  url: string | null;
  kind: AssetKindCard;
  contentType: string;
  sizeBytes: number;
  ext: string;
  stream: boolean;
  streamUrl: string | null;
  /** How to open in this app */
  openHints: string[];
  /** Human + agent markdown */
  markdown: string;
  /** Compact JSON for tools */
  summary: string;
  /** Optional AI caption (images) or model graph stats */
  aiNote: string | null;
  model?: {
    meshCount: number;
    materialCount: number;
    animationCount: number;
    totalTriangles: number;
    totalVertices: number;
  };
}

export interface AssetUnderstandFail {
  ok: false;
  error: string;
}

export type AssetUnderstandResult = AssetUnderstandCard | AssetUnderstandFail;

function classifyKind(name: string): AssetKindCard {
  if (isThreeScenePath(name)) return "scene3d";
  if (isModelPath(name)) return "model3d";
  if (isImagePath(name)) return "image";
  if (isAudioPath(name)) return "audio";
  if (isVideoPath(name)) return "video";
  const ext = extname(name).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if ([".txt", ".json", ".md", ".yml", ".yaml", ".ts", ".tsx", ".js", ".css", ".html"].includes(ext)) {
    return "text";
  }
  return "file";
}

function openHintsFor(kind: AssetKindCard, stream: boolean): string[] {
  const is3d = kind === "model3d" || kind === "scene3d";
  const hints = [
    is3d
      ? "Local Files: click = inline preview · double-click / Pop-out = ThreeFlow (save, multi-mesh)"
      : "Local Files: double-click / Pop-out = Elite media viewer (not Forge)",
    "System open = OS default app (Blender / Photoshop / Photos / …)",
    "Explorer: Open with Grudge Dev Tool after Settings → Set as default",
  ];
  if (kind === "video" || kind === "audio") {
    hints.push(stream ? "Playback streams via grudge-media:// (no full RAM load)" : "Use stream URL for large media");
  }
  if (is3d) {
    hints.push("Forge live only via explicit Forge action (needs CDN URL)");
    hints.push("GLB/GLTF: model inspect (meshes / mats / clips / tris) is on this card");
  }
  if (kind === "image") {
    hints.push("AI card + withAi = vision caption (CF / Legion)");
  }
  return hints;
}

/**
 * Build an AI-readable card for a disk path or remote asset name+url.
 * @param opts.withAi — when true, run vision caption for images (needs CF/Legion).
 */
export async function understandAsset(opts: {
  path?: string;
  name?: string;
  url?: string;
  contentType?: string;
  size?: number;
  withAi?: boolean;
}): Promise<AssetUnderstandResult> {
  try {
    let abs: string | null = null;
    let name = opts.name?.trim() || "";
    let size = typeof opts.size === "number" && opts.size > 0 ? opts.size : 0;
    let url = opts.url?.trim() || null;

    if (opts.path && typeof opts.path === "string") {
      abs = resolve(opts.path);
      if (!existsSync(abs)) return { ok: false, error: `File not found: ${abs}` };
      const st = statSync(abs);
      if (!st.isFile()) return { ok: false, error: `Not a file: ${abs}` };
      name = name || basename(abs);
      size = size || st.size;
    }

    if (!name && url) {
      try {
        name = basename(new URL(url).pathname) || "asset";
      } catch {
        name = "asset";
      }
    }
    if (!name) return { ok: false, error: "path or name required" };

    const kind = classifyKind(name);
    const contentType = opts.contentType || inferContentType(name);
    const stream = isStreamableMediaPath(name);
    const streamUrl = abs && stream ? mediaStreamUrl(abs) : null;
    if (abs && stream && !url) url = streamUrl;

    const openHints = openHintsFor(kind, stream);
    let aiNote: string | null = null;
    let model:
      | {
          meshCount: number;
          materialCount: number;
          animationCount: number;
          totalTriangles: number;
          totalVertices: number;
        }
      | undefined;

    // GLB/GLTF structural inspect (local only)
    if (abs && (kind === "model3d" || kind === "scene3d") && /\.(glb|gltf)$/i.test(name)) {
      try {
        const insp = await inspectModel(abs);
        if (insp.ok) {
          model = {
            meshCount: insp.stats.meshCount,
            materialCount: insp.stats.materialCount,
            animationCount: insp.stats.animationCount,
            totalTriangles: insp.stats.totalTriangles,
            totalVertices: insp.stats.totalVertices,
          };
          const clips = insp.animations.slice(0, 8).map((a) => a.name).join(", ");
          aiNote = `GLTF: ${insp.stats.meshCount} meshes, ${insp.stats.materialCount} mats, ${insp.stats.animationCount} clips, ${insp.stats.totalTriangles} tris${clips ? `; clips: ${clips}` : ""}`;
        } else {
          aiNote = insp.error || "model inspect failed";
        }
      } catch (e: unknown) {
        aiNote = e instanceof Error ? e.message : String(e);
      }
    }

    // Vision caption for images (optional — needs fleet AI)
    if (opts.withAi && abs && kind === "image") {
      try {
        const maxCap = 4 * 1024 * 1024;
        if (size > 0 && size <= maxCap) {
          const buf = await readFile(abs);
          const cap = await workersAiCaption({ imageBytes: buf });
          if (cap.result?.description) {
            aiNote = (aiNote ? aiNote + "\n" : "") + `Vision: ${cap.result.description}`;
          }
        } else if (size > maxCap) {
          aiNote = (aiNote ? aiNote + "\n" : "") + "Image too large for inline vision caption (>4MB).";
        }
      } catch (e: unknown) {
        log.warn("[assetUnderstand] caption failed", e);
        aiNote = (aiNote ? aiNote + "\n" : "") + `Vision unavailable: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // Text head sample for tiny scripts
    if (abs && kind === "text" && size > 0 && size < 64 * 1024) {
      try {
        const raw = await readFile(abs, "utf8");
        const head = raw.slice(0, 400).replace(/\r\n/g, "\n");
        aiNote = `Text head:\n\`\`\`\n${head}${raw.length > 400 ? "\n…" : ""}\n\`\`\``;
      } catch {
        /* ignore */
      }
    }

    if (kind === "video") {
      aiNote =
        (aiNote ? aiNote + "\n" : "") +
        "Video: open in elite VideoViewer (stream). Prefer H.264 MP4 / WebM for Chromium.";
    }
    if (kind === "audio") {
      aiNote =
        (aiNote ? aiNote + "\n" : "") +
        "Audio: elite AudioViewer stream + optional waveform under 24MB. Good for game SFX test.";
    }

    const sizeKb = size > 0 ? `${(size / 1024).toFixed(1)} KB` : "unknown size";
    const lines = [
      `## Asset card: ${name}`,
      "",
      `| Field | Value |`,
      `| --- | --- |`,
      `| kind | \`${kind}\` |`,
      `| mime | \`${contentType}\` |`,
      `| size | ${sizeKb} (${size} bytes) |`,
      `| stream | ${stream ? "yes" : "no"} |`,
      abs ? `| path | \`${abs}\` |` : null,
      url ? `| url | \`${url}\` |` : null,
      model
        ? `| model | meshes=${model.meshCount} mats=${model.materialCount} anims=${model.animationCount} tris=${model.totalTriangles} |`
        : null,
      "",
      "### Open",
      ...openHints.map((h) => `- ${h}`),
      "",
      aiNote ? `### AI / inspect\n${aiNote}` : "### AI / inspect\n_(none yet — use withAi for image vision)_",
      "",
      "### Agent instructions",
      `- Treat kind=\`${kind}\` when routing tools (ThreeFlow for 3D edit · Elite for media · convert / caption).`,
      `- Do not force Forge for audio/video/image; Forge is 3D deploy only, explicit.`,
      kind === "model3d" || kind === "scene3d"
        ? `- 3D edit is ThreeFlow, not Elite chrome.`
        : null,
      stream ? `- Use stream URL for playback, never full-file blob for large media.` : null,
    ].filter(Boolean) as string[];

    const markdown = lines.join("\n");
    const summary = [
      `kind=${kind}`,
      `name=${name}`,
      `mime=${contentType}`,
      `size=${size}`,
      stream ? "stream=1" : "stream=0",
      abs ? `path=${abs}` : null,
      model ? `meshes=${model.meshCount};tris=${model.totalTriangles};anims=${model.animationCount}` : null,
      aiNote ? `note=${aiNote.slice(0, 200)}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    return {
      ok: true,
      name,
      path: abs,
      url,
      kind,
      contentType,
      sizeBytes: size,
      ext: extname(name).replace(/^\./, "").toLowerCase(),
      stream,
      streamUrl,
      openHints,
      markdown,
      summary,
      aiNote,
      model,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("[assetUnderstand]", msg);
    return { ok: false, error: msg };
  }
}
