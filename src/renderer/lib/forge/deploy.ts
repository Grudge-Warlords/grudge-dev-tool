import * as THREE from "three";
import { exportToGlb } from "./converters";
import { getGameDeployment } from "../../../shared/gameDeployments";
import {
  buildRegistryRow,
  guessCategory,
  prodGltfKey,
  PROD_GLTF_PREFIX,
} from "../../../shared/prodGltf";
import { assertMeshBytes } from "../../../shared/magicBytes";
import { sanitizeMaterials } from "./materialSanitize";

export interface FleetDeployResult {
  ok: boolean;
  key?: string;
  publicUrl?: string | null;
  grudgeUUID?: string;
  rig?: string;
  gameId?: string;
  registrySeeded?: boolean;
  materialsFixed?: number;
  errors?: string[];
  warnings?: string[];
}

export interface FleetDeployOptions {
  object: THREE.Object3D;
  animations?: THREE.AnimationClip[];
  filenameBase: string;
  prefix: string;
  categoryId: string;
  runIngest: boolean;
  itemId?: number;
  /** When set, prefer game deployment prefix / category from SSOT */
  gameId?: string;
  /**
   * Upload under prod/gltf/<category>/ (fleet mesh SSOT).
   * Default true — set false only for legacy pack prefixes.
   */
  useProdGltf?: boolean;
  /** prod/gltf category segment (characters, weapons, …). */
  prodCategory?: string;
  /** Seed ObjectStore/D1 index after successful PUT. Default true. */
  seedRegistry?: boolean;
}

/** Export GLB → material sanitize → magic-byte → optional ingest → R2 prod/gltf → D1 seed. */
export async function deployToFleet(opts: FleetDeployOptions): Promise<FleetDeployResult> {
  const game = opts.gameId ? getGameDeployment(opts.gameId) : undefined;
  const categoryId = game?.storeCategoryId ?? opts.categoryId;
  const useProd = opts.useProdGltf !== false;
  const legacyPrefix = (game?.deployPrefix || opts.prefix || "models/").replace(/^\/+|\/+$/g, "");
  const prodCat = opts.prodCategory || guessCategory(opts.filenameBase || categoryId);

  // Fix yellow/black before export so baked GLB carries sane materials
  const matReport = sanitizeMaterials(opts.object, {
    format: "glb",
    toonStyle: true,
  });

  const exported = await exportToGlb(
    opts.object,
    opts.animations ?? [],
    opts.filenameBase.replace(/\.[^.]+$/, ""),
  );

  // Magic-byte gate on exported bytes
  try {
    assertMeshBytes(exported.bytes, exported.filename);
  } catch (err: any) {
    return {
      ok: false,
      errors: [err?.message ?? String(err)],
      materialsFixed: matReport.fixed,
      gameId: opts.gameId,
    };
  }

  const tempPath: string = await window.grudge.forge.writeTempFile({
    name: exported.filename,
    bytes: new Uint8Array(exported.bytes),
  });

  let uploadPath = tempPath;
  let grudgeUUID: string | undefined;
  let rig: string | undefined;
  let ingestR2Key: string | undefined;
  let registryRow: ReturnType<typeof buildRegistryRow> | undefined;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (matReport.fixed > 0) {
    warnings.push(`Material sanitize fixed ${matReport.fixed} issue(s) before export`);
  }

  if (opts.runIngest) {
    const ingest = await window.grudge.ingest.one(tempPath, {
      category: categoryId,
      itemId: opts.itemId ?? (Date.now() % 9999) + 1,
      makeThumbnail: true,
      enrichAssetType: "model",
      preferProdGltf: useProd,
      prodCategory: prodCat,
    }) as {
      ok: boolean;
      errors: string[];
      warnings: string[];
      grudgeUUID?: string;
      outputPath?: string;
      rig?: string;
      r2Key?: string;
      registryRow?: ReturnType<typeof buildRegistryRow>;
    };
    errors.push(...(ingest.errors ?? []));
    warnings.push(...(ingest.warnings ?? []));
    if (!ingest.ok) {
      return {
        ok: false,
        errors,
        warnings,
        materialsFixed: matReport.fixed,
        gameId: opts.gameId,
      };
    }
    grudgeUUID = ingest.grudgeUUID;
    rig = ingest.rig;
    if (ingest.outputPath) uploadPath = ingest.outputPath;
    ingestR2Key = ingest.r2Key;
    registryRow = ingest.registryRow;
  }

  const baseName = uploadPath.split(/[\\/]/).pop() ?? exported.filename;
  const key =
    ingestR2Key ||
    (useProd
      ? prodGltfKey({ category: prodCat, name: baseName })
      : `${legacyPrefix}/${baseName}`);

  const signed = await window.grudge.cf.r2SignedUpload({
    key,
    contentType: "model/gltf-binary",
    ttlSeconds: 900,
  }) as { ok: boolean; url?: string; error?: string };

  if (!signed.ok || !signed.url) {
    return {
      ok: false,
      errors: [...errors, signed.error ?? "Failed to mint signed URL"],
      warnings,
      materialsFixed: matReport.fixed,
      gameId: opts.gameId,
    };
  }

  // Prefer re-read from ingest output when convert rewrote the file
  let body: ArrayBuffer | Uint8Array = exported.bytes;
  if (uploadPath !== tempPath && window.grudge?.forge?.readFile) {
    try {
      const raw = await window.grudge.forge.readFile(uploadPath);
      const bytes = raw?.bytes ?? raw?.data ?? raw;
      if (bytes && (bytes.byteLength > 0 || bytes.length > 0)) {
        body = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes);
      }
    } catch {
      /* use exported.bytes */
    }
  }

  const put = await fetch(signed.url, {
    method: "PUT",
    headers: { "content-type": "model/gltf-binary" },
    body: body as BodyInit,
  });
  if (!put.ok) {
    return {
      ok: false,
      errors: [...errors, `PUT ${put.status} ${put.statusText}`],
      warnings,
      materialsFixed: matReport.fixed,
      gameId: opts.gameId,
    };
  }

  const publicUrl = await window.grudge.cf.r2PublicUrl(key) as string | null;
  if (publicUrl) {
    try { await navigator.clipboard.writeText(publicUrl); } catch { /* ignore */ }
  }

  // Seed D1 / ObjectStore registry so fleet search finds the asset
  let registrySeeded = false;
  if (opts.seedRegistry !== false) {
    const row =
      registryRow ||
      (grudgeUUID
        ? buildRegistryRow({
            grudgeUUID,
            r2Key: key,
            category: prodCat,
            sizeBytes: (body as ArrayBuffer).byteLength ?? (body as Uint8Array).byteLength ?? 0,
            name: baseName,
            metadata: {
              layout: PROD_GLTF_PREFIX,
              gameId: opts.gameId ?? game?.id,
              materialsFixed: matReport.fixed,
            },
          })
        : null);
    if (row) {
      try {
        // Prefer ObjectStore manifest upsert when available
        if (window.grudge?.os?.registerAsset) {
          await window.grudge.os.registerAsset(row);
          registrySeeded = true;
        } else if (window.grudge?.cf?.seedRegistry) {
          await window.grudge.cf.seedRegistry({ entries: [row] });
          registrySeeded = true;
        } else if (window.grudge?.os?.writeManifest) {
          await window.grudge.os.writeManifest({
            packId: `prod-gltf-${prodCat}`,
            version: new Date().toISOString().slice(0, 10),
            entries: [row],
            meta: { source: "grudge-dev-tool-deploy", layout: PROD_GLTF_PREFIX },
          });
          registrySeeded = true;
        } else {
          warnings.push(
            "R2 upload OK but no registry seed API (os.registerAsset / cf.seedRegistry) — index manually or run D1 seed.",
          );
        }
      } catch (err: any) {
        warnings.push(`Registry seed failed: ${err?.message ?? String(err)}`);
      }
    }
  }

  return {
    ok: true,
    key,
    publicUrl,
    grudgeUUID,
    rig,
    gameId: opts.gameId ?? game?.id,
    registrySeeded,
    materialsFixed: matReport.fixed,
    errors: errors.length ? errors : undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}