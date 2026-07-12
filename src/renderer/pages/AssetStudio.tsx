/**
 * Assets → 3D Studio
 * Local 3D viewer + converter. Browser "View 3D" lands here with the asset loaded.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Box, Upload, Download, Link2, Fingerprint, FolderOpen, Loader2, FileBox,
} from "lucide-react";
import Forge3D from "./Forge3D";
import { convertToGlb, downloadBlob, SUPPORTED_FORMATS, ACCEPT_ATTR } from "../lib/forge/converters";
import { readMirror, writeMirror } from "../lib/workspace";
import { useWorkspaceField } from "../lib/useWorkspaceField";
import { is3dAssetPath } from "../lib/openInForge";

export default function AssetStudio() {
  const [pendingUrl, setPendingUrl] = useWorkspaceField("assetStudioPendingUrl", "");
  const [pendingPath, setPendingPath] = useWorkspaceField("assetStudioPendingPath", "");
  const [statusLine, setStatusLine] = useState<string>("Drop a model or open one from Browser");
  const [uuid, setUuid] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  const clearUrl = useCallback(() => {
    setPendingUrl("" as any);
    writeMirror({ assetStudioPendingUrl: "" });
    void window.grudge.workspace?.patch?.({ assetStudioPendingUrl: "" });
  }, [setPendingUrl]);

  const clearPath = useCallback(() => {
    setPendingPath("" as any);
    writeMirror({ assetStudioPendingPath: "" });
    void window.grudge.workspace?.patch?.({ assetStudioPendingPath: "" });
  }, [setPendingPath]);

  const loadFromUrl = useCallback(async (url: string, showToast = true) => {
    const u = url.trim();
    if (!u || (!is3dAssetPath(u) && !u.includes("assets.grudge-studio.com"))) return false;
    setStatusLine("Loading from CDN…");
    setUrlInput(u);
    try {
      await window.grudge.forge.openRemote(u);
      setStatusLine(u);
      try {
        const key = new URL(u).pathname.replace(/^\//, "");
        const id = await window.grudge.registry?.uuidForPath?.(key);
        if (id) setUuid(id);
      } catch { /* */ }
      if (showToast) toast.success("Model loaded in 3D Studio");
      return true;
    } catch (e: any) {
      toast.error("Failed to open model", { description: e?.message });
      return false;
    } finally {
      clearUrl();
    }
  }, [clearUrl]);

  const loadFromPath = useCallback(async (path: string, showToast = true) => {
    const p = path.trim();
    if (!p) return false;
    setStatusLine(`Loading ${p}…`);
    try {
      await window.grudge.forge.openPath(p);
      setStatusLine(p);
      if (showToast) toast.success("Model loaded in 3D Studio");
      return true;
    } catch (e: any) {
      toast.error("Failed to open file", { description: e?.message });
      return false;
    } finally {
      clearPath();
    }
  }, [clearPath]);

  // Consume pending open from Browser / Engine whenever route lands with a payload
  useEffect(() => {
    const mirror = readMirror();
    const url = (pendingUrl || mirror.assetStudioPendingUrl || "").trim();
    const path = (pendingPath || mirror.assetStudioPendingPath || "").trim();
    if (url) {
      void loadFromUrl(url);
      return;
    }
    if (path) void loadFromPath(path);
  }, [pendingUrl, pendingPath, loadFromUrl, loadFromPath]);

  // Re-open while already on /assets-3d (mirror/field won't remount)
  useEffect(() => {
    const onOpen = (ev: Event) => {
      const d = (ev as CustomEvent<{ url?: string; path?: string }>).detail || {};
      if (d.url) void loadFromUrl(d.url);
      else if (d.path) void loadFromPath(d.path);
    };
    window.addEventListener("grudge:asset-studio-open", onOpen);
    return () => window.removeEventListener("grudge:asset-studio-open", onOpen);
  }, [loadFromUrl, loadFromPath]);

  const openUrl = useCallback(async () => {
    const u = urlInput.trim();
    if (!u) return;
    if (!is3dAssetPath(u) && !u.includes("assets.grudge-studio.com")) {
      toast.error("URL must point to a 3D model (.glb, .fbx, …)");
      return;
    }
    try {
      await window.grudge.forge.openRemote(u);
      setStatusLine(u);
      toast.success("Model loaded");
      try {
        const key = new URL(u).pathname.replace(/^\//, "");
        const id = await window.grudge.registry?.uuidForPath?.(key);
        if (id) setUuid(id);
      } catch { /* */ }
    } catch (e: any) {
      toast.error("Load failed", { description: e?.message });
    }
  }, [urlInput]);

  const onConvertFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setConverting(true);
    try {
      for (const file of Array.from(files)) {
        const result = await convertToGlb(file);
        downloadBlob(result.blob, result.filename);
        toast.success(`Converted ${file.name} → ${result.filename}`, {
          description: `${result.triangles.toLocaleString()} tris · ${result.durationMs}ms`,
        });
      }
    } catch (e: any) {
      toast.error("Convert failed", { description: e?.message ?? String(e) });
    } finally {
      setConverting(false);
    }
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <header className="shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="page-title flex items-center gap-2 mb-0">
              <Box size={20} className="text-gold" />
              3D Studio
            </h1>
            <p className="page-sub mt-1 mb-0">
              View &amp; convert models from Object Storage Browser or disk. Browser → <strong>View 3D</strong> opens here.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className="btn ghost text-xs flex items-center gap-1"
              onClick={() => window.grudge.app.openRoute("/browser")}
            >
              <FolderOpen size={12} /> Browser
            </button>
            <button
              type="button"
              className="btn ghost text-xs flex items-center gap-1"
              onClick={() => window.grudge.app.openRoute("/forge")}
            >
              Full Forge
            </button>
          </div>
        </div>

        <div className="card mt-2 !py-2 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <div className="flex-1 flex gap-1 min-w-0">
            <Link2 size={14} className="text-muted shrink-0 mt-2" />
            <input
              className="flex-1 text-[11px] font-mono"
              placeholder="https://assets.grudge-studio.com/models/…/file.glb"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void openUrl()}
            />
            <button type="button" className="btn text-xs shrink-0" onClick={() => void openUrl()}>
              Load URL
            </button>
          </div>
          <label className="btn ghost text-xs flex items-center gap-1 cursor-pointer shrink-0">
            {converting ? <Loader2 size={12} className="animate-spin" /> : <FileBox size={12} />}
            Convert → GLB
            <input
              type="file"
              className="hidden"
              accept={ACCEPT_ATTR}
              multiple
              disabled={converting}
              onChange={(e) => void onConvertFiles(e.target.files)}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2 mt-1 text-[10px] text-muted">
          <span className="truncate max-w-full">{statusLine}</span>
          {uuid && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-gold font-mono hover:underline"
              title="Copy Grudge UUID"
              onClick={() => {
                void navigator.clipboard.writeText(uuid);
                toast.success("Copied UUID");
              }}
            >
              <Fingerprint size={10} /> {uuid}
            </button>
          )}
          <span className="opacity-60">Formats: {SUPPORTED_FORMATS.join(", ")}</span>
        </div>
      </header>

      <div className="flex-1 min-h-0 border border-line rounded-md overflow-hidden bg-bg-0">
        <Forge3D />
      </div>
    </div>
  );
}
