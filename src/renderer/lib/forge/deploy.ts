import * as THREE from "three";
import { exportToGlb } from "./converters";

export interface FleetDeployResult {
  ok: boolean;
  key?: string;
  publicUrl?: string | null;
  grudgeUUID?: string;
  rig?: string;
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
}

/** Export GLB → optional ingest pipeline → signed R2 upload. */
export async function deployToFleet(opts: FleetDeployOptions): Promise<FleetDeployResult> {
  const exported = await exportToGlb(
    opts.object,
    opts.animations ?? [],
    opts.filenameBase.replace(/\.[^.]+$/, ""),
  );

  const tempPath: string = await window.grudge.forge.writeTempFile({
    name: exported.filename,
    bytes: new Uint8Array(exported.bytes),
  });

  let uploadPath = tempPath;
  let grudgeUUID: string | undefined;
  let rig: string | undefined;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (opts.runIngest) {
    const ingest = await window.grudge.ingest.one(tempPath, {
      category: opts.categoryId,
      itemId: opts.itemId ?? (Date.now() % 9999) + 1,
      makeThumbnail: true,
      enrichAssetType: "model",
    }) as {
      ok: boolean;
      errors: string[];
      warnings: string[];
      grudgeUUID?: string;
      outputPath?: string;
      rig?: string;
    };
    errors.push(...(ingest.errors ?? []));
    warnings.push(...(ingest.warnings ?? []));
    if (!ingest.ok) {
      return { ok: false, errors, warnings };
    }
    grudgeUUID = ingest.grudgeUUID;
    rig = ingest.rig;
    if (ingest.outputPath) uploadPath = ingest.outputPath;
  }

  const safePrefix = opts.prefix.replace(/^\/+|\/+$/g, "");
  const baseName = uploadPath.split(/[\\/]/).pop() ?? exported.filename;
  const key = `${safePrefix}/${baseName}`;

  const signed = await window.grudge.cf.r2SignedUpload({
    key,
    contentType: "model/gltf-binary",
    ttlSeconds: 900,
  }) as { ok: boolean; url?: string; error?: string };

  if (!signed.ok || !signed.url) {
    return { ok: false, errors: [...errors, signed.error ?? "Failed to mint signed URL"], warnings };
  }

  const put = await fetch(signed.url, {
    method: "PUT",
    headers: { "content-type": "model/gltf-binary" },
    body: exported.bytes,
  });
  if (!put.ok) {
    return { ok: false, errors: [...errors, `PUT ${put.status} ${put.statusText}`], warnings };
  }

  const publicUrl = await window.grudge.cf.r2PublicUrl(key) as string | null;
  if (publicUrl) {
    try { await navigator.clipboard.writeText(publicUrl); } catch { /* ignore */ }
  }

  return {
    ok: true,
    key,
    publicUrl,
    grudgeUUID,
    rig,
    errors: errors.length ? errors : undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}