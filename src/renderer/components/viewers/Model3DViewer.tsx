import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { loadModelFromUrl, isSupported } from "../../lib/forge/loaders";
import { measureObjectSi } from "../../lib/forge/siMeasure";
import {
  getMultiCanvasHub,
  type MultiCanvasView,
} from "../../lib/forge/multiCanvasHub";
import {
  VIEWPORT_NAVIGATION_HELP,
  applyViewportNavigation,
  perspectiveFitDistance,
  viewportNavigationActionFromButton,
  viewportNavigationActionLabel,
  type ViewportNavigationAction,
} from "../../lib/forge/viewportNavigation";
import {
  PROMPT3D_CAMERA_PRESETS,
  createPrompt3DVisualInspection,
  prompt3DVisualInspectionRequirements,
  recordPrompt3DClipPlayback,
  recordPrompt3DViewpoint,
  setPrompt3DInspectionAttestation,
  type Prompt3DCameraPreset,
  type Prompt3DInspectionAttestation,
  type Prompt3DVisualInspectionProgress,
  type Prompt3DVisualInspectionStage,
} from "../../../shared/prompt3dVisualInspection";
import type { AssetRef } from "./types";

interface Stats {
  triangles: number;
  vertices: number;
  bones: number;
  animations: number;
  format: string;
  materialsFixed?: number;
  missingMaps?: number;
  heightM?: number;
}

interface ClipOption {
  index: number;
  name: string;
  duration: number;
}

export interface Model3DViewerLoadState {
  assetPath: string;
  status: "loading" | "ready" | "error";
  error?: string;
}

/**
 * Inline 3D preview using MultiCanvasHub (single WebGL → many canvases).
 * Pattern: three.js multi-canvas (webgpu_multiple_canvas / webgl_multiple_elements).
 * Avoids one WebGLRenderer per thumbnail (context loss / yellow sludge / black frames).
 */
export default function Model3DViewer({
  asset,
  onLocateInList,
  onLoadStateChange,
  visualInspectionStage,
  visualInspectionAssetSha256,
  onVisualInspectionChange,
  preserveAuthoredMaterials = false,
  highlightRegion,
  preferredClipName,
}: {
  asset: AssetRef;
  /** Scroll the Local Files list to this viewport asset. */
  onLocateInList?: () => void;
  /** Reports readiness or failure for the exact local path/URL being displayed. */
  onLoadStateChange?: (state: Model3DViewerLoadState) => void;
  /** Enables the explicit Prompt-to-3D inspection gate for this exact revision. */
  visualInspectionStage?: Prompt3DVisualInspectionStage;
  /** Exact retained bytes expected to be on screen while this inspection runs. */
  visualInspectionAssetSha256?: string;
  /** Reports retained per-asset inspection progress to the workflow panel. */
  onVisualInspectionChange?: (progress: Prompt3DVisualInspectionProgress | null) => void;
  /** Show decoded authored PBR values/maps exactly; used for visual approval. */
  preserveAuthoredMaterials?: boolean;
  preferredClipName?: string;
  highlightRegion?: { targetNames:string[]; color:string; label:string };
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<MultiCanvasView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedObject,setLoadedObject]=useState<THREE.Object3D|null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [playing, setPlaying] = useState(false);
  const [clipOptions, setClipOptions] = useState<ClipOption[]>([]);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [activeCameraPreset, setActiveCameraPreset] = useState<Prompt3DCameraPreset | null>(null);
  const [inspectionProgress, setInspectionProgress] = useState<Prompt3DVisualInspectionProgress | null>(null);
  const [activeNavigationAction, setActiveNavigationAction] = useState<ViewportNavigationAction | null>(null);
  const [lastNavigationAction, setLastNavigationAction] = useState<ViewportNavigationAction | null>(null);
  const actionsRef = useRef<THREE.AnimationAction[]>([]);
  const activeNavigationActionRef = useRef<ViewportNavigationAction | null>(null);
  const navigationIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraDwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPlaybackSampleRef = useRef<{ clipIndex: number; mixerTime: number } | null>(null);
  const onLoadStateChangeRef = useRef(onLoadStateChange);
  const onVisualInspectionChangeRef = useRef(onVisualInspectionChange);
  onLoadStateChangeRef.current = onLoadStateChange;
  onVisualInspectionChangeRef.current = onVisualInspectionChange;

  useEffect(()=>{
    if(!loadedObject||!highlightRegion)return;
    const restore:Array<()=>void>=[];
    loadedObject.traverse(node=>{
      const mesh=node as THREE.Mesh;if(!mesh.isMesh)return;
      const indices=highlightRegion.targetNames.map(name=>mesh.morphTargetDictionary?.[name]).filter((i):i is number=>i!==undefined);
      if(!indices.length)return;
      const originalGeometry=mesh.geometry,originalMaterial=mesh.material,geometry=originalGeometry.clone();
      const positions=geometry.getAttribute("position"),morphs=geometry.morphAttributes.position??[];
      const weights=new Float32Array(positions.count);let max=0;
      for(let i=0;i<positions.count;i++){let weight=0;for(const index of indices){const a=morphs[index];if(a)weight=Math.max(weight,Math.hypot(a.getX(i),a.getY(i),a.getZ(i)));}weights[i]=weight;max=Math.max(max,weight);}
      const colors=new Float32Array(positions.count*3),base=new THREE.Color("#132237"),highlight=new THREE.Color(highlightRegion.color),color=new THREE.Color();
      for(let i=0;i<positions.count;i++){color.copy(base).lerp(highlight,max?Math.sqrt(weights[i]/max):0);color.toArray(colors,i*3);}
      geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
      const material=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});mesh.geometry=geometry;mesh.material=material;
      restore.push(()=>{mesh.geometry=originalGeometry;mesh.material=originalMaterial;geometry.dispose();material.dispose();});
    });
    const bounds=new THREE.Box3().setFromObject(loadedObject),axes=new THREE.AxesHelper(Math.max(...bounds.getSize(new THREE.Vector3()).toArray())*.4);
    loadedObject.add(axes);
    return()=>{restore.forEach(fn=>fn());loadedObject.remove(axes);axes.dispose();};
  },[loadedObject,highlightRegion?.color,highlightRegion?.label,JSON.stringify(highlightRegion?.targetNames)]);

  // Create multi-canvas view once per mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const hub = getMultiCanvasHub();
    const view = hub.createView(canvas, {
      quality: "medium",
      background: 0x0a0e1a,
      showGrid: true,
      hdri: true,
    });
    viewRef.current = view;
    applyViewportNavigation(view.controls);
    const cancelPresetDwell = () => {
      if (cameraDwellTimerRef.current) clearTimeout(cameraDwellTimerRef.current);
      cameraDwellTimerRef.current = null;
      setActiveCameraPreset(null);
    };
    const beginNavigation = (event: PointerEvent) => {
      const action = viewportNavigationActionFromButton(event.button);
      activeNavigationActionRef.current = action;
      setActiveNavigationAction(action);
      if (navigationIdleTimerRef.current) clearTimeout(navigationIdleTimerRef.current);
      navigationIdleTimerRef.current = action ? setTimeout(finishNavigation, 1_200) : null;
    };
    const finishNavigation = () => {
      if (navigationIdleTimerRef.current) clearTimeout(navigationIdleTimerRef.current);
      navigationIdleTimerRef.current = null;
      const action = activeNavigationActionRef.current;
      activeNavigationActionRef.current = null;
      setActiveNavigationAction(null);
      if (action) setLastNavigationAction(action);
    };
    const continueNavigation = () => {
      if (!activeNavigationActionRef.current) return;
      if (navigationIdleTimerRef.current) clearTimeout(navigationIdleTimerRef.current);
      navigationIdleTimerRef.current = setTimeout(finishNavigation, 1_200);
    };
    const recordWheelZoom = () => {
      activeNavigationActionRef.current = null;
      setActiveNavigationAction(null);
      setLastNavigationAction("zoom");
    };
    view.controls.addEventListener("start", cancelPresetDwell);
    view.controls.addEventListener("end", finishNavigation);
    canvas.addEventListener("pointerdown", beginNavigation);
    canvas.addEventListener("pointermove", continueNavigation);
    canvas.addEventListener("pointerup", finishNavigation);
    canvas.addEventListener("pointercancel", finishNavigation);
    canvas.addEventListener("lostpointercapture", finishNavigation);
    canvas.addEventListener("wheel", recordWheelZoom, { passive: true });
    window.addEventListener("pointerup", finishNavigation);
    window.addEventListener("pointercancel", finishNavigation);
    window.addEventListener("blur", finishNavigation);
    return () => {
      if (cameraDwellTimerRef.current) clearTimeout(cameraDwellTimerRef.current);
      if (navigationIdleTimerRef.current) clearTimeout(navigationIdleTimerRef.current);
      view.controls.removeEventListener("start", cancelPresetDwell);
      view.controls.removeEventListener("end", finishNavigation);
      canvas.removeEventListener("pointerdown", beginNavigation);
      canvas.removeEventListener("pointermove", continueNavigation);
      canvas.removeEventListener("pointerup", finishNavigation);
      canvas.removeEventListener("pointercancel", finishNavigation);
      canvas.removeEventListener("lostpointercapture", finishNavigation);
      canvas.removeEventListener("wheel", recordWheelZoom);
      window.removeEventListener("pointerup", finishNavigation);
      window.removeEventListener("pointercancel", finishNavigation);
      window.removeEventListener("blur", finishNavigation);
      hub.disposeView(view);
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    onVisualInspectionChangeRef.current?.(inspectionProgress);
  }, [inspectionProgress]);

  useEffect(() => {
    if (!inspectionProgress || inspectionProgress.stage !== "animation") return;
    const interval = setInterval(() => {
      const action = actionsRef.current[activeClipIndex];
      if (!action) return;
      const current = { clipIndex: activeClipIndex, mixerTime: action.getMixer().time };
      const previous = lastPlaybackSampleRef.current;
      lastPlaybackSampleRef.current = current;
      const view = viewRef.current;
      if (!playing || !view?.visible || document.visibilityState !== "visible" || previous === null || previous.clipIndex !== activeClipIndex) return;
      const elapsedSeconds = Math.max(0, current.mixerTime - previous.mixerTime);
      setInspectionProgress((current) => current
        ? recordPrompt3DClipPlayback(current, activeClipIndex, elapsedSeconds)
        : current);
    }, 100);
    return () => {
      clearInterval(interval);
      lastPlaybackSampleRef.current = null;
    };
  }, [inspectionProgress?.assetPath, inspectionProgress?.stage, playing, activeClipIndex]);

  // Load / swap model when asset changes
  useEffect(() => {
    let cancelled = false;
    const assetPath = asset.localPath || asset.url;
    setError(null);
    setLoading(true);
    setLoadedObject(null);
    setStats(null);
    actionsRef.current = [];
    setClipOptions([]);
    setActiveClipIndex(0);
    setActiveCameraPreset(null);
    setInspectionProgress(null);
    activeNavigationActionRef.current = null;
    if (navigationIdleTimerRef.current) clearTimeout(navigationIdleTimerRef.current);
    navigationIdleTimerRef.current = null;
    setActiveNavigationAction(null);
    setLastNavigationAction(null);
    if (cameraDwellTimerRef.current) clearTimeout(cameraDwellTimerRef.current);
    cameraDwellTimerRef.current = null;
    lastPlaybackSampleRef.current = null;
    setPlaying(false);
    onLoadStateChangeRef.current?.({ assetPath, status: "loading" });

    (async () => {
      const view = viewRef.current;
      if (!view) {
        const message = "The 3D preview canvas is unavailable.";
        if (!cancelled) {
          setError(message);
          setLoading(false);
          onLoadStateChangeRef.current?.({ assetPath, status: "error", error: message });
        }
        return;
      }
      try {
        // Reassert the shared contract at each asset/workflow-stage handoff so
        // no prior editor modifier or stale viewer state can change the mapping.
        applyViewportNavigation(view.controls);
        if (!isSupported(asset.name)) {
          throw new Error(`Unsupported 3D format: ${asset.name}`);
        }
        const nameHint = asset.name.split("/").pop() ?? asset.name;
        const loaded = await loadModelFromUrl(asset.url, nameHint, {
          diskPath: asset.localPath || undefined,
          materialPolicy: preserveAuthoredMaterials ? "preserve-authored" : "normalize",
          skipGenericPreview: preserveAuthoredMaterials,
          ...(preserveAuthoredMaterials
            ? {}
            : { sanitize: { toonStyle: true, fixDefaultYellow: true, whiteWhenMapped: true } }),
        });
        if (cancelled || !viewRef.current) return;

        // Clear previous mixers
        for (const m of view.mixers) m.stopAllAction();
        view.mixers.length = 0;

        getMultiCanvasHub().setRoot(view, loaded.object);
        setLoadedObject(loaded.object);

        const skinned = loaded.bones > 0;
        let loadedClipOptions: ClipOption[] = [];
        if (skinned || loaded.animations.length > 0) {
          const { attachAnimationMixer, setPrimaryAction } = await import(
            "../../lib/forge/forgeAnimation"
          );
          const handle = attachAnimationMixer(loaded.object, loaded.animations, {
            // Prompt-to-3D approval must show authored travel, not a stationary
            // in-place preview that could conceal an incorrect motion path.
            dropRootMotion: visualInspectionStage !== "animation" && !preferredClipName,
          });
          view.mixers.push(handle.mixer);
          actionsRef.current = handle.clips.map((c) => handle.mixer.clipAction(c));
          loadedClipOptions = handle.clips.map((clip, index) => ({
            index,
            name: clip.name?.trim() || `Clip ${index + 1}`,
            duration: Math.max(0, clip.duration),
          }));
          setClipOptions(loadedClipOptions);
          if (handle.clips.length) {
            const index=preferredClipName?handle.clips.findIndex(c=>c.name===preferredClipName):0;
            if(index<0)throw new Error("The retained motion clip is missing from this preview.");
            setPrimaryAction(handle.mixer, handle.clips[index], "repeat");
            getMultiCanvasHub().setPromptMotionClip(view, handle.clips[index]);
            setActiveClipIndex(index);

            setPlaying(true);
          }
        }

        const missingMaps =
          loaded.materials?.issues.filter((i) => i.code === "missing-map" && !i.fixed).length ?? 0;
        const si = measureObjectSi(loaded.object);
        setStats({
          triangles: loaded.triangles,
          vertices: loaded.vertices,
          bones: loaded.bones,
          animations: loaded.animations.length,
          format: loaded.format,
          materialsFixed: loaded.materials?.fixed,
          missingMaps,
          heightM: si.h,
        });
        if (visualInspectionStage) {
          if (!visualInspectionAssetSha256) throw new Error("Exact asset SHA-256 is required for visual inspection.");
          setInspectionProgress(createPrompt3DVisualInspection(
            assetPath,
            visualInspectionAssetSha256,
            visualInspectionStage,
            visualInspectionStage === "animation" ? loadedClipOptions : [],
          ));
        }
        onLoadStateChangeRef.current?.({ assetPath, status: "ready" });
      } catch (e: unknown) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : String(e);
          setError(message);
          onLoadStateChangeRef.current?.({ assetPath, status: "error", error: message });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [asset.url, asset.localPath, asset.name, preserveAuthoredMaterials, visualInspectionStage, visualInspectionAssetSha256, preferredClipName]);

  function toggleAnim() {
    const next = !playing;
    const action = actionsRef.current[activeClipIndex];
    if (!action) return;
    action.paused = !next;
    if (next) action.play();
    setPlaying(next);
  }

  function selectClip(index: number) {
    const action = actionsRef.current[index];
    if (!action) return;
    for (const candidate of actionsRef.current) candidate.stop();
    action.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
    const view = viewRef.current;
    if (view) getMultiCanvasHub().setPromptMotionClip(view, action.getClip());
    setActiveClipIndex(index);
    setPlaying(true);
  }

  function inspectCameraPreset(preset: Prompt3DCameraPreset) {
    const view = viewRef.current;
    if (!view?.root || !inspectionProgress) return;
    const box = new THREE.Box3().setFromObject(view.root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.05);
    const aspect = Math.max(0.1, view.camera.aspect || 1);
    const fov = THREE.MathUtils.degToRad(view.camera.fov);
    const [projectedWidth, projectedHeight] = preset === "front" || preset === "back"
      ? [size.x, size.y]
      : preset === "right" || preset === "left"
        ? [size.z, size.y]
        : [size.x, size.z];
    const distance = perspectiveFitDistance(projectedWidth, projectedHeight, fov, aspect);
    const direction = {
      front: new THREE.Vector3(0, 0, 1),
      right: new THREE.Vector3(1, 0, 0),
      back: new THREE.Vector3(0, 0, -1),
      left: new THREE.Vector3(-1, 0, 0),
      top: new THREE.Vector3(0, 1, 0),
      bottom: new THREE.Vector3(0, -1, 0),
    }[preset];
    view.camera.up.set(0, 1, 0);
    if (preset === "top") view.camera.up.set(0, 0, -1);
    if (preset === "bottom") view.camera.up.set(0, 0, 1);
    view.camera.position.copy(center).addScaledVector(direction, distance);
    view.camera.near = Math.max(0.001, maxDim / 400);
    view.camera.far = Math.max(50, distance * 12 + maxDim * 8);
    view.camera.updateProjectionMatrix();
    view.controls.target.copy(center);
    view.controls.update();
    setActiveCameraPreset(preset);
    if (cameraDwellTimerRef.current) clearTimeout(cameraDwellTimerRef.current);
    cameraDwellTimerRef.current = setTimeout(() => {
      setInspectionProgress((current) => current ? recordPrompt3DViewpoint(current, preset) : current);
      cameraDwellTimerRef.current = null;
    }, 350);
  }

  function changeInspectionAttestation(attestation: Prompt3DInspectionAttestation, accepted: boolean) {
    setInspectionProgress((current) => current
      ? setPrompt3DInspectionAttestation(current, attestation, accepted)
      : current);
  }

  const inspectionRequirements = inspectionProgress
    ? prompt3DVisualInspectionRequirements(inspectionProgress)
    : null;
  const navigationContext = visualInspectionStage
    ? `Exact ${visualInspectionStage} inspection navigation`
    : "Preview navigation";
  const navigationStatus = activeNavigationAction
    ? `${viewportNavigationActionLabel(activeNavigationAction)} active`
    : lastNavigationAction
      ? `${navigationContext} ready · Last: ${viewportNavigationActionLabel(lastNavigationAction)}`
      : `${navigationContext} ready`;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#0a0e1a" }}>
      {/* Display canvas — hub blits WebGL here (multi-canvas present) */}
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", outline: "none" }}
      />
      {!inspectionProgress && <div
        role="status"
        aria-live="polite"
        data-viewport-navigation-status={activeNavigationAction ?? "ready"}
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 3,
          maxWidth: "min(430px, calc(100% - 16px))",
          border: "1px solid rgba(255,198,42,.35)",
          borderRadius: 6,
          background: "rgba(8,12,25,0.9)",
          color: "var(--muted)",
          padding: "6px 9px",
          fontSize: 10,
          lineHeight: 1.35,
          pointerEvents: "none",
        }}
      >
        <b style={{ color: activeNavigationAction ? "var(--gold)" : "var(--fg)" }}>{navigationStatus}</b>
        <span style={{ display: "block", marginTop: 2 }}>{VIEWPORT_NAVIGATION_HELP}</span>
      </div>}
      {inspectionProgress && inspectionRequirements && (
        <section
          aria-label="Exact visual inspection"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 3,
            width: "min(390px, calc(100% - 16px))",
            maxHeight: "calc(100% - 72px)",
            overflowY: "auto",
            background: "rgba(8,12,25,0.94)",
            border: `1px solid ${inspectionRequirements.complete ? "rgba(52,211,153,.55)" : "rgba(255,198,42,.42)"}`,
            borderRadius: 8,
            padding: 10,
            color: "var(--fg)",
            fontSize: 11,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <b>Exact {inspectionProgress.stage} inspection</b>
            <span style={{ color: inspectionRequirements.complete ? "#6ee7b7" : "var(--gold)" }}>
              {inspectionRequirements.complete ? "Ready to approve" : `${inspectionRequirements.inspectedViewpoints}/${inspectionRequirements.requiredViewpoints} views`}
            </span>
          </div>
          <div
            role="status"
            aria-live="polite"
            data-viewport-navigation-status={activeNavigationAction ?? "ready"}
            style={{
              marginTop: 7,
              border: "1px solid rgba(255,198,42,.3)",
              borderRadius: 5,
              background: "rgba(255,198,42,.06)",
              padding: "5px 7px",
              color: "var(--muted)",
              lineHeight: 1.35,
            }}
          >
            <b style={{ color: activeNavigationAction ? "var(--gold)" : "var(--fg)" }}>{navigationStatus}</b>
            <span style={{ display: "block", marginTop: 2 }}>{VIEWPORT_NAVIGATION_HELP}</span>
          </div>
          <p style={{ margin: "6px 0", color: "var(--muted)", lineHeight: 1.35 }}>
            Select and inspect at least four distinct fixed views. A view is retained after it remains visible briefly.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5 }}>
            {PROMPT3D_CAMERA_PRESETS.map((preset) => {
              const inspected = inspectionProgress.viewpoints.some((viewpoint) => viewpoint.preset === preset);
              return <button
                key={preset}
                type="button"
                aria-pressed={activeCameraPreset === preset}
                onClick={() => inspectCameraPreset(preset)}
                style={{
                  border: `1px solid ${inspected ? "rgba(52,211,153,.65)" : activeCameraPreset === preset ? "var(--gold)" : "var(--line)"}`,
                  borderRadius: 5,
                  background: activeCameraPreset === preset ? "rgba(255,198,42,.12)" : "var(--bg)",
                  color: inspected ? "#6ee7b7" : "var(--fg)",
                  padding: "4px 5px",
                  textTransform: "capitalize",
                  cursor: "pointer",
                }}
              >{inspected ? "✓ " : ""}{preset}</button>;
            })}
          </div>
          <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "flex-start", lineHeight: 1.3 }}>
              <input
                type="checkbox"
                checked={Boolean(inspectionProgress.attestations.geometryIdentityAndCompleteness)}
                onChange={(event) => changeInspectionAttestation("geometryIdentityAndCompleteness", event.target.checked)}
              />
              <span>I visually confirm the model identity, required parts, silhouette and completeness.</span>
            </label>
            {inspectionProgress.stage === "texture" && <label style={{ display: "flex", gap: 6, alignItems: "flex-start", lineHeight: 1.3 }}>
              <input
                type="checkbox"
                checked={Boolean(inspectionProgress.attestations.materialCoverageAndAppearance)}
                onChange={(event) => changeInspectionAttestation("materialCoverageAndAppearance", event.target.checked)}
              />
              <span>I visually confirm complete material coverage and appropriate surface appearance.</span>
            </label>}
            {inspectionProgress.stage === "animation" && <>
              <div style={{ color: "var(--muted)" }}>
                Full clip playback: {inspectionRequirements.completedClips}/{inspectionRequirements.requiredClips}
                {inspectionProgress.clips.map((clip) => <div key={`${clip.index}-${clip.name}`} style={{ marginTop: 3 }}>
                  {clip.completedAt ? "✓" : "○"} {clip.name} · {Math.min(clip.duration, clip.playedSeconds).toFixed(2)}/{clip.duration.toFixed(2)}s
                </div>)}
              </div>
              <label style={{ display: "flex", gap: 6, alignItems: "flex-start", lineHeight: 1.3 }}>
                <input
                  type="checkbox"
                  checked={Boolean(inspectionProgress.attestations.animationMotionMatchesPrompt)}
                  onChange={(event) => changeInspectionAttestation("animationMotionMatchesPrompt", event.target.checked)}
                />
                <span>I visually confirm the played motion matches the animation prompt.</span>
              </label>
            </>}
          </div>
          {!inspectionRequirements.complete && <p role="status" style={{ margin: "7px 0 0", color: "#fcd34d", lineHeight: 1.35 }}>
            {inspectionRequirements.missing[0]}
          </p>}
        </section>
      )}
      {loading && (
        <div
          style={{
            position: "absolute",
            top: 64,
            left: 12,
            background: "rgba(15,21,48,0.88)",
            border: "1px solid var(--line)",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--gold)",
          }}
        >
          Loading model…
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            inset: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--danger)",
            fontSize: 12,
            textAlign: "center",
            padding: 12,
          }}
        >
          {error}
        </div>
      )}
      {(onLocateInList || stats) && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 6,
            zIndex: 2,
          }}
        >
      {onLocateInList && (
        <button
          type="button"
          onClick={onLocateInList}
          title="Scroll the left list to this viewport asset"
          style={{
            background: "rgba(15,21,48,0.92)",
            border: "1px solid var(--gold)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 11,
            color: "var(--gold)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Show in list
        </button>
      )}
      {stats && (
        <div
          style={{
            background: "rgba(15,21,48,0.88)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 11,
            color: "var(--muted)",
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ color: "var(--gold)" }}>{stats.format.toUpperCase()}</span>
          <span>{stats.triangles.toLocaleString()} tris</span>
          <span>{stats.vertices.toLocaleString()} verts</span>
          {stats.bones > 0 && <span>{stats.bones} bones</span>}
          {typeof stats.heightM === "number" && stats.heightM > 0 && (
            <span title="SI height">{stats.heightM.toFixed(2)} m</span>
          )}
          {typeof stats.materialsFixed === "number" && stats.materialsFixed > 0 && (
            <span title="Material sanitize fixed yellow/black/colorSpace" style={{ color: "#7dffa0" }}>
              mats+{stats.materialsFixed}
            </span>
          )}
          {typeof stats.missingMaps === "number" && stats.missingMaps > 0 && (
            <span title="No baseColor map — re-bake with atlas" style={{ color: "#ffb86c" }}>
              no-map×{stats.missingMaps}
            </span>
          )}
          {stats.animations > 0 && <>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span>Clip</span>
              <select
                aria-label="Animation clip"
                title={`Current animation: ${clipOptions[activeClipIndex]?.name ?? "unavailable"}`}
                value={activeClipIndex}
                onChange={(event) => selectClip(Number(event.target.value))}
                style={{ maxWidth: 210, border: "1px solid var(--line)", borderRadius: 4, background: "var(--bg)", color: "var(--fg)", padding: "2px 4px" }}
              >
                {clipOptions.map((clip) => <option key={`${clip.index}-${clip.name}`} value={clip.index}>{clip.name} · {clip.duration.toFixed(2)}s</option>)}
              </select>
            </label>
            <button type="button" onClick={toggleAnim} className="text-gold hover:underline" aria-label={`${playing ? "Pause" : "Play"} ${clipOptions[activeClipIndex]?.name ?? "animation"}`}>
              {playing ? "Pause" : "Play"}
            </button>
          </>}
          <span title="Shared multi-canvas WebGL hub" style={{ opacity: 0.55, fontSize: 10 }}>
            multi-canvas
          </span>
        </div>
      )}
        </div>
      )}
    </div>
  );
}
