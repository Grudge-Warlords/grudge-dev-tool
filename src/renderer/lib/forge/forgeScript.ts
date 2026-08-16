/**
 * Lightweight Forge scripting API — run short JS against the live scene.
 * No Node access; only the sandbox API is exposed.
 */

import * as THREE from "three";
import type { SceneEngine } from "./sceneEngine";
import {
  applyAnimationsToTarget,
  buildProceduralClip,
  type UnriggedPreset,
} from "./animApply";
import { applySmartTextures, filterImagePaths } from "./textureFinder";
import { loadModelFromUrl } from "./loaders";
import { exportToGlb, downloadBlob } from "./converters";
import { threeflowAssetUrl, forgeStudioAssetUrl, isPublicCdnUrl } from "../../../shared/editorHandoff";

export interface ForgeScriptItem {
  id: string;
  name: string;
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  mixer: THREE.AnimationMixer | null;
  bones: number;
}

export interface ForgeScriptHost {
  engine: SceneEngine;
  items: ForgeScriptItem[];
  selectedId: string | null;
  getSelected(): ForgeScriptItem | null;
  setSelectedId(id: string | null): void;
  mergeAnimations(itemId: string, clips: THREE.AnimationClip[]): void;
  playClip(item: ForgeScriptItem, clip: THREE.AnimationClip): void;
  frame(object?: THREE.Object3D): void;
  frameAll(): void;
  log: (msg: string) => void;
}

export interface ForgeScriptResult {
  ok: boolean;
  logs: string[];
  error?: string;
  value?: unknown;
}

/** Build the `api` object injected into scripts. */
export function buildForgeApi(host: ForgeScriptHost) {
  const logs: string[] = [];
  const log = (msg: string) => {
    logs.push(String(msg));
    host.log(String(msg));
  };

  return {
    logs,
    log,
    THREE,
    get items() {
      return host.items.map((i) => ({
        id: i.id,
        name: i.name,
        bones: i.bones,
        clips: i.animations.length,
      }));
    },
    get selected() {
      const s = host.getSelected();
      if (!s) return null;
      return { id: s.id, name: s.name, bones: s.bones, clips: s.animations.length };
    },
    select(id: string) {
      host.setSelectedId(id);
    },
    frame(all = false) {
      if (all) host.frameAll();
      else {
        const s = host.getSelected();
        host.frame(s?.object);
      }
    },
    frameAll() {
      host.frameAll();
    },
    play(index = 0) {
      const s = host.getSelected();
      if (!s?.animations[index]) {
        log(`No clip at index ${index}`);
        return;
      }
      host.playClip(s, s.animations[index]);
      log(`Playing ${s.animations[index].name}`);
    },
    stop() {
      host.engine.mixers.forEach((m) => m.stopAllAction());
      log("Stopped all mixers");
    },
    addProcedural(preset: UnriggedPreset = "spin-y") {
      const s = host.getSelected();
      if (!s) {
        log("Nothing selected");
        return;
      }
      const clip = buildProceduralClip(s.object, preset);
      host.mergeAnimations(s.id, [...s.animations, clip]);
      log(`Added procedural ${preset}`);
    },
    applyAnimsFrom(sourceItemId: string) {
      const s = host.getSelected();
      const src = host.items.find((i) => i.id === sourceItemId);
      if (!s || !src) {
        log("Need selected target + valid source id");
        return;
      }
      const result = applyAnimationsToTarget(src.animations, s.object, {
        source: src.object,
        dropRootChain: true,
      });
      host.mergeAnimations(s.id, [...s.animations, ...result.clips]);
      log(`Applied ${result.clips.length} clips (${result.mode})`);
      result.warnings.forEach(log);
    },
    async findAndApplyTextures(paths: string[]) {
      const s = host.getSelected();
      if (!s) {
        log("Nothing selected");
        return;
      }
      const images = filterImagePaths(paths);
      const reports = await applySmartTextures(s.object, images);
      log(`Texture pass: ${reports.length} materials touched`);
      for (const r of reports) {
        log(`${r.meshName}/${r.materialName}: ${r.applied.map((a) => a.role).join(", ") || "none"}`);
      }
    },
    listBones() {
      const s = host.getSelected();
      if (!s) return [];
      const names: string[] = [];
      s.object.traverse((n) => {
        if ((n as THREE.Bone).isBone) names.push(n.name);
      });
      log(`${names.length} bones`);
      return names;
    },
    /** ThreeFlow scratch-pad names — same graph, not a second runner. */
    get scene() {
      return host.engine.scene;
    },
    get camera() {
      return host.engine.activeCamera;
    },
    get renderer() {
      return host.engine.renderer;
    },
    get object() {
      return host.getSelected()?.object ?? null;
    },
    async loadUrl(url: string, nameHint?: string) {
      const localMedia = url.startsWith("grudge-media:");
      if (!isPublicCdnUrl(url) && !localMedia) {
        log("loadUrl: need https CDN or grudge-media URL");
        return null;
      }
      const loaded = await loadModelFromUrl(url, nameHint);
      log(`loaded ${loaded.format} · ${loaded.triangles} tris · ${loaded.animations.length} clips`);
      return loaded;
    },
    async exportSelected(filenameBase = "export") {
      const s = host.getSelected();
      if (!s) {
        log("Nothing selected");
        return null;
      }
      const result = await exportToGlb(s.object, s.animations, filenameBase);
      downloadBlob(result.blob, result.filename);
      log(`exported ${result.filename} (${result.triangles} tris)`);
      return result.filename;
    },
    openThreeFlow(cdnUrl: string) {
      if (!isPublicCdnUrl(cdnUrl)) {
        log("openThreeFlow: need public https URL");
        return null;
      }
      const href = threeflowAssetUrl(cdnUrl);
      void window.grudge?.os?.openExternal?.(href);
      log(href);
      return href;
    },
    openForge(cdnUrl: string) {
      if (!isPublicCdnUrl(cdnUrl)) {
        log("openForge: need public https URL");
        return null;
      }
      const href = forgeStudioAssetUrl(cdnUrl);
      void window.grudge?.os?.openExternal?.(href);
      log(href);
      return href;
    },
    help() {
      const lines = [
        "api.frame() / api.frameAll()",
        "api.play(index) · api.stop()",
        "api.addProcedural('spin-y'|'bob'|'float'|...)",
        "api.applyAnimsFrom(sourceItemId)",
        "api.findAndApplyTextures(pathArray)",
        "api.listBones() · api.items · api.selected · api.select(id)",
        "api.loadUrl(cdn) · api.exportSelected('name')",
        "api.openThreeFlow(cdn) · api.openForge(cdn)",
        "api.scene · api.camera · api.renderer · api.object · api.THREE",
        "api.log(msg)",
      ];
      lines.forEach(log);
      return lines;
    },
  };
}

/**
 * Run a user script string. Supports top-level await.
 */
export async function runForgeScript(
  source: string,
  host: ForgeScriptHost,
): Promise<ForgeScriptResult> {
  const api = buildForgeApi(host);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "api",
      `"use strict"; return (async () => {\n${source}\n})();`,
    );
    const value = await fn(api);
    return { ok: true, logs: api.logs, value };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    api.log(`Error: ${error}`);
    return { ok: false, logs: api.logs, error };
  }
}

export const SCRIPT_EXAMPLES: Array<{ label: string; code: string }> = [
  {
    label: "Frame + play first clip",
    code: `api.frame();\napi.play(0);\napi.log("framed + playing");`,
  },
  {
    label: "Spin unrigged prop",
    code: `api.addProcedural("spin-y");\napi.play(api.selected?.clips ? api.selected.clips - 1 : 0);`,
  },
  {
    label: "List bones",
    code: `const bones = api.listBones();\napi.log(bones.slice(0, 20).join(", "));`,
  },
  {
    label: "Help",
    code: `api.help();`,
  },
];
