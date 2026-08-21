/**
 * Pipeline Review AI Worker (main process).
 *
 * Plans convert / SI / laterality / optimize / R2 / D1 / CDN HEAD.
 * Same stack as Scene Completion: aiChat + allowlist + heuristic fallback.
 * Does not invent a Cloudflare Agents SDK app.
 */

import { basename, extname, join } from "node:path";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { aiChat } from "./aiWorkerManager";
import { convertFile } from "../ingestion/convert";
import { verifyFile } from "../ingestion/sizeVerify";
import { assertMeshFile, probeFileMagic } from "../ingestion/magicVerify";
import { isHtmlContentType, probeMagic } from "../../shared/magicBytes";
import { FLEET_URLS } from "../../shared/fleet";
import {
  PIPELINE_REVIEW_BEST_PRACTICES,
  PIPELINE_REVIEW_OPS,
  PIPELINE_REVIEW_VERSION,
  buildHeuristicPipelineReviewPlan,
  CONVERT_EXTS,
  needsConvert,
  normalizePipelineReviewPlan,
  type PipelineReviewPlan,
  type PipelineReviewRequest,
} from "../../shared/pipelineReview";

const SYSTEM_PROMPT = `You are the Grudge Studio Pipeline Review AI Worker.
You plan convert-before-upload, SI, laterality, and CDN verify for the Dev Tool Three Pipeline.
You do NOT invent meshes, a second editor, or player-bag writes.

Return ONLY compact JSON (no markdown fences):
{
  "summary": "one line",
  "confidence": 0.0-1.0,
  "steps": [
    { "id": "1", "op": "convert", "reason": "...", "priority": 10, "params": {} }
  ],
  "risks": ["..."],
  "bestPractices": ["..."]
}

ALLOWED ops only: ${Object.keys(PIPELINE_REVIEW_OPS).join(", ")}

Rules:
1. Always start with diagnose.
2. Convert FBX/OBJ/STL/glTF JSON to GLB before upload-r2.
3. Magic-byte + head-cdn after PUT. Reject HTML 200s.
4. seed-d1 is index only (r2_key) — never bag/XP.
5. SI 1 unit = 1 m. If height is insane, measure-2m (user Shift+Ctrl+LMB), do not guess scale.
6. Characters: laterality → strip-position → ensure-mixer. One mixer.
7. Play mesh = Toon {race}.glb, not Meshy/capsule/raw FBX.
8. Keep 3–12 steps. Include 2–5 bestPractices.`;

function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* continue */
  }
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("Pipeline review AI returned non-JSON");
}

export async function planPipelineReview(
  req: PipelineReviewRequest,
): Promise<PipelineReviewPlan> {
  const heuristic = buildHeuristicPipelineReviewPlan(req);

  if (req.mode === "character" || req.mode === "si-only") {
    return { ...heuristic, source: "heuristic" };
  }

  const user = [
    `Asset: ${req.name}`,
    `mode: ${req.mode ?? "auto"}`,
    req.goal ? `goal: ${req.goal}` : null,
    `stats: ${JSON.stringify(req.stats)}`,
    "",
    "Heuristic draft (refine order/params, keep allowlisted ops only):",
    JSON.stringify({ summary: heuristic.summary, steps: heuristic.steps }, null, 0),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await aiChat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 900,
      track: true,
      model: req.providerHint === "ollama" ? "ollama" : undefined,
      provider: req.providerHint as any,
    });

    const parsed = extractJson(res.text);
    const plan = normalizePipelineReviewPlan(parsed, heuristic);
    return {
      ...plan,
      source: plan.steps.length ? "hybrid" : "heuristic",
      provider: res.provider,
      model: res.model,
      latencyMs: res.latencyMs,
      bestPractices:
        plan.bestPractices.length > 0
          ? plan.bestPractices
          : PIPELINE_REVIEW_BEST_PRACTICES.slice(0, 6),
      version: PIPELINE_REVIEW_VERSION,
    };
  } catch (err) {
    return {
      ...heuristic,
      source: "heuristic",
      risks: [
        ...heuristic.risks,
        `AI planner unavailable: ${err instanceof Error ? err.message : String(err)} — using heuristic pipeline`,
      ],
      bestPractices: PIPELINE_REVIEW_BEST_PRACTICES.slice(0, 6),
    };
  }
}

export function pipelineReviewWorkerInfo() {
  return {
    id: "pipeline-review",
    name: "Pipeline Review",
    description:
      "Convert-before-upload, magic-byte, SI, laterality, optimize, R2+D1, CDN HEAD for the Grudge Three Pipeline",
    ops: Object.keys(PIPELINE_REVIEW_OPS),
    bestPractices: PIPELINE_REVIEW_BEST_PRACTICES,
    version: PIPELINE_REVIEW_VERSION,
  };
}

export interface PipelinePrepareResult {
  ok: boolean;
  path: string;
  name: string;
  contentType: string;
  converted: boolean;
  conversionKind?: string;
  magic: string;
  sizeBytes: number;
  error?: string;
  warnings?: string[];
}

/** Convert DCC → GLB when needed, then magic-byte gate. Used by Send to R2 + D1. */
export async function preparePipelineUpload(args: {
  localPath: string;
  name?: string;
}): Promise<PipelinePrepareResult> {
  const src = args.localPath;
  if (!src) return { ok: false, path: "", name: "", contentType: "", converted: false, magic: "", sizeBytes: 0, error: "localPath required" };

  const label = args.name || basename(src);
  const ext = extname(src).toLowerCase();
  const warnings: string[] = [];

  try {
    let outPath = src;
    let converted = false;
    let conversionKind = "none";

    const fakeStats = {
      name: label,
      format: ext.replace(".", "") || "bin",
      ext,
      meshCount: 0,
      triangles: 0,
      vertices: 0,
      bones: 0,
      clips: 0,
      hasSkinnedMesh: false,
      siHeightM: 0,
      siWidthM: 0,
      siSource: "unknown" as const,
      missingMaps: 0,
    };
    if (needsConvert(fakeStats) || CONVERT_EXTS.has(ext)) {
      const verify = await verifyFile(src);
      const conv = await convertFile(src, verify, { outDir: join(tmpdir(), "grudge-pipeline-upload") });
      if (!conv.ok) {
        return {
          ok: false,
          path: src,
          name: label,
          contentType: "application/octet-stream",
          converted: false,
          magic: "",
          sizeBytes: 0,
          error: conv.errors.join("; ") || "convert failed",
          warnings: conv.warnings,
        };
      }
      outPath = conv.outputPath;
      converted = conv.converted;
      conversionKind = conv.conversionKind;
      warnings.push(...conv.warnings);
    }

    const outExt = extname(outPath).toLowerCase();
    if (outExt === ".glb" || outExt === ".gltf") {
      await assertMeshFile(outPath);
    }
    const magic = await probeFileMagic(outPath);
    if ((outExt === ".glb" || outExt === ".gltf") && !magic.okForMesh) {
      return {
        ok: false,
        path: outPath,
        name: basename(outPath),
        contentType: "application/octet-stream",
        converted,
        conversionKind,
        magic: magic.detail,
        sizeBytes: magic.bytes,
        error: `not a mesh after convert (${magic.detail})`,
        warnings,
      };
    }

    const st = await fs.stat(outPath);
    const contentType =
      outExt === ".glb"
        ? "model/gltf-binary"
        : outExt === ".gltf"
          ? "model/gltf+json"
          : "application/octet-stream";

    return {
      ok: true,
      path: outPath,
      name: basename(outPath),
      contentType,
      converted,
      conversionKind,
      magic: magic.detail,
      sizeBytes: st.size,
      warnings,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      path: src,
      name: label,
      contentType: "application/octet-stream",
      converted: false,
      magic: "",
      sizeBytes: 0,
      error: e instanceof Error ? e.message : String(e),
      warnings,
    };
  }
}

export interface CdnHeadResult {
  ok: boolean;
  url: string;
  status: number | null;
  contentType: string | null;
  size: number | null;
  magic?: string;
  error?: string;
}

/** HEAD CDN URL, reject HTML, Range-GET first bytes for GLB magic. */
export async function headCdnVerify(url: string): Promise<CdnHeadResult> {
  const target = url?.trim();
  if (!target) {
    return { ok: false, url: "", status: null, contentType: null, size: null, error: "url required" };
  }
  const abs = /^https?:\/\//i.test(target)
    ? target
    : `${FLEET_URLS.assets}/${target.replace(/^\//, "")}`;

  try {
    const head = await fetch(abs, { method: "HEAD" });
    const ct = head.headers.get("content-type");
    const sizeRaw = head.headers.get("content-length");
    const size = sizeRaw ? Number(sizeRaw) : null;
    if (isHtmlContentType(ct)) {
      return {
        ok: false,
        url: abs,
        status: head.status,
        contentType: ct,
        size,
        error: `CDN Content-Type ${ct} is HTML (error page), not a mesh`,
      };
    }
    if (!head.ok) {
      return {
        ok: false,
        url: abs,
        status: head.status,
        contentType: ct,
        size,
        error: `HEAD HTTP ${head.status}`,
      };
    }

    let magic: string | undefined;
    if (/\.glb($|\?)/i.test(abs) || /\.gltf($|\?)/i.test(abs)) {
      const range = await fetch(abs, { headers: { Range: "bytes=0-63" } });
      const buf = new Uint8Array(await range.arrayBuffer());
      const probe = probeMagic(buf);
      magic = probe.detail;
      if (!probe.okForMesh) {
        return {
          ok: false,
          url: abs,
          status: range.status,
          contentType: ct,
          size,
          magic,
          error: `CDN body is not a mesh (${probe.detail})`,
        };
      }
    }

    return {
      ok: true,
      url: abs,
      status: head.status,
      contentType: ct,
      size,
      magic,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      url: abs,
      status: null,
      contentType: null,
      size: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
