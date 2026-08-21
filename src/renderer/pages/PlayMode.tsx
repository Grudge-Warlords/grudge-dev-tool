/**
 * Native Three Play — real game-player harness on SceneEngine + gltfProdLoader.
 * Fleet clients stay on Preview webview. This tab walks a Toon kit with one mixer.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Gamepad2,
  FolderOpen,
  HelpCircle,
  Loader2,
  Film,
  Wand2,
  RotateCcw,
} from "lucide-react";
import { SceneEngine } from "../lib/forge/sceneEngine";
import { loadModelFromUrl } from "../lib/forge/loaders";
import { attachAnimationMixer } from "../lib/forge/forgeAnimation";
import { PlayRuntime } from "../lib/forge/playRuntime";
import { runForgeScript, type ForgeScriptHost } from "../lib/forge/forgeScript";
import { TOON_PLAY_KITS, CDN_BASE } from "../../shared/prodPackages";
import {
  PLAY_HOTKEYS,
  loadPlaySettings,
  savePlaySettings,
  type PlaySettings,
} from "../../shared/playHotkeys";
import { measureObjectSi } from "../lib/forge/siMeasure";

const G = () => (window as any).grudge;

function toonUrl(id: string): string {
  const kit = TOON_PLAY_KITS[id] ?? TOON_PLAY_KITS.human;
  return `${CDN_BASE}/${kit.r2Key}`;
}

export default function PlayMode() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const runtimeRef = useRef<PlayRuntime | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading Toon human…");
  const [hud, setHud] = useState(true);
  const [help, setHelp] = useState(false);
  const [clipName, setClipName] = useState("—");
  const [si, setSi] = useState("");
  const [locked, setLocked] = useState(false);
  const [gait, setGait] = useState("idle");
  const [settings, setSettings] = useState<PlaySettings>(() => loadPlaySettings());
  const [script, setScript] = useState(
    `// Forge play script — one mixer, production loader\napi.log("clips: " + (api.items[0]?.clips ?? 0));\napi.play(0);\n`,
  );
  const [log, setLog] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [kit, setKit] = useState("human");

  const appendLog = useCallback((msg: string) => {
    setLog((prev) => `${prev}${prev ? "\n" : ""}${msg}`.slice(-4000));
  }, []);

  const bootKit = useCallback(async (url: string, nameHint: string, diskPath?: string) => {
    const host = hostRef.current;
    if (!host) return;
    setLoading(true);
    setStatus(`Load ${nameHint}`);
    runtimeRef.current?.stop();
    runtimeRef.current = null;
    engineRef.current?.dispose();
    engineRef.current = null;
    host.replaceChildren();

    const engine = new SceneEngine(host, {
      background: 0x0a0e1a,
      showGrid: true,
      showGround: true,
      hdri: true,
    });
    engineRef.current = engine;

    try {
      const loaded = await loadModelFromUrl(url, nameHint, {
        diskPath,
        sanitize: { toonStyle: true, fixDefaultYellow: true, whiteWhenMapped: true },
      });
      engine.scene.add(loaded.object);
      const box = measureObjectSi(loaded.object);
      loaded.object.position.y = -box.min[1];
      const anim = attachAnimationMixer(loaded.object, loaded.animations, { dropRootMotion: true });
      if (anim.mixer) engine.mixers.push(anim.mixer);
      const rt = new PlayRuntime(engine, loaded.object, anim.mixer, anim.clips, loadPlaySettings());
      rt.start();
      runtimeRef.current = rt;
      engine.frame(loaded.object);
      setSi(`${box.h.toFixed(2)} m · ${loaded.bones} bones · ${anim.clips.length} clips`);
      setClipName(anim.clips[0]?.name ?? "none");
      setStatus(nameHint);
      toast.success("Play ready", { description: `${nameHint} · click canvas to look` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
      toast.error("Play load failed", { description: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const q = (() => {
      try {
        const h = window.location.hash || "";
        const raw = h.includes("?") ? h.split("?")[1] : "";
        const p = new URLSearchParams(raw);
        return { glb: p.get("glb") || undefined, kit: p.get("kit") || undefined };
      } catch {
        return {};
      }
    })();
    const id = q.kit && TOON_PLAY_KITS[q.kit] ? q.kit : "human";
    setKit(id);
    const url = q.glb || toonUrl(id);
    void bootKit(url, q.glb ? "custom" : `${id}.glb`);
    return () => {
      runtimeRef.current?.stop();
      engineRef.current?.dispose();
    };
  }, [bootKit]);

  useEffect(() => {
    savePlaySettings(settings);
    const rt = runtimeRef.current;
    if (rt) rt.settings = settings;
  }, [settings]);

  useEffect(() => {
    const canvas = engineRef.current?.renderer.domElement;
    const host = hostRef.current;
    if (!host) return;

    const onClick = () => {
      const c = engineRef.current?.renderer.domElement;
      if (c) runtimeRef.current?.lock(c);
    };
    const onMove = (e: MouseEvent) => runtimeRef.current?.onMouse(e.movementX, e.movementY);
    const onLock = () => setLocked(!!document.pointerLockElement);
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/i.test(el.tagName)) return;
      const rt = runtimeRef.current;
      if (!rt) return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        setHelp((h) => !h);
        return;
      }
      if (e.code === "KeyH" && !e.ctrlKey && !e.metaKey) {
        setHud((h) => !h);
        return;
      }
      if (e.code === "KeyV" && !e.ctrlKey) {
        const on = rt.toggleVideo();
        toast.message(on ? "Video on" : "Video off");
        return;
      }
      if (e.code === "Escape") rt.unlock();
      if (e.code === "F5") {
        e.preventDefault();
        void bootKit(toonUrl(kit), `${kit}.glb`);
        return;
      }
      if (e.code >= "Digit0" && e.code <= "Digit9" && !e.ctrlKey) {
        const n = Number(e.code.slice(-1));
        const name = rt.playClipIndex(n);
        if (name) setClipName(name);
      }
    };
    const poll = window.setInterval(() => {
      const rt = runtimeRef.current;
      if (!rt) return;
      setLocked(rt.locked);
      setGait(rt.gait);
    }, 200);

    host.addEventListener("click", onClick);
    window.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onLock);
    window.addEventListener("keydown", onKey);
    return () => {
      host.removeEventListener("click", onClick);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onLock);
      window.removeEventListener("keydown", onKey);
      window.clearInterval(poll);
      void canvas;
    };
  }, [loading, kit, bootKit]);

  const runScript = useCallback(async () => {
    const engine = engineRef.current;
    const rt = runtimeRef.current;
    if (!engine || !rt) return;
    const host: ForgeScriptHost = {
      engine,
      items: [
        {
          id: "player",
          name: status,
          object: rt.player,
          animations: rt.clips,
          mixer: rt.mixer,
          bones: 0,
        },
      ],
      selectedId: "player",
      getSelected: () => host.items[0],
      setSelectedId: () => undefined,
      mergeAnimations: (_id, clips) => {
        rt.clips = clips;
      },
      playClip: (_item, clip) => {
        const i = rt.clips.indexOf(clip);
        rt.playClipIndex(i >= 0 ? i + 1 : 1);
      },
      frame: (obj) => engine.frame(obj ?? rt.player),
      frameAll: () => engine.frame(rt.player),
      log: appendLog,
    };
    const r = await runForgeScript(script, host);
    if (!r.ok) toast.error(r.error || "script failed");
    else toast.success("Script ok");
  }, [appendLog, script, status]);

  const aiScript = useCallback(async () => {
    setAiBusy(true);
    try {
      const res = await G()?.fleet?.aiChat?.({
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "You write short Grudge Forge play scripts. API: api.play(i), api.stop(), api.log, api.scene, api.THREE, api.items. Return ONLY JavaScript, no markdown.",
          },
          {
            role: "user",
            content: `Player kit ${kit}, clips shown as ${clipName}. Write a 8-line script that logs clip count and plays idle or clip 0.`,
          },
        ],
      });
      const text = String(res?.text ?? res ?? "").replace(/^```(?:js|javascript)?\n?|\n?```$/g, "");
      if (text.trim()) setScript(text.trim());
      else toast.message("AI unavailable — heuristic script kept");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "AI script failed");
    } finally {
      setAiBusy(false);
    }
  }, [clipName, kit]);

  const kits = useMemo(() => Object.keys(TOON_PLAY_KITS), []);

  return (
    <div className="flex h-full min-h-0 bg-[#0a0c12] text-slate-200">
      <aside className="w-[220px] shrink-0 border-r border-white/10 p-3 flex flex-col gap-3 overflow-auto">
        <div className="flex items-center gap-2 text-emerald-200">
          <Gamepad2 size={16} />
          <span className="text-xs font-semibold tracking-wide">Native Three Play</span>
        </div>
        <p className="text-[10px] text-slate-500 leading-snug">
          Production loader · one mixer · WASD. Not a second editor. Fleet clients stay on Preview.
        </p>
        <label className="text-[10px] uppercase tracking-wide text-slate-500">Toon play kit</label>
        <select
          className="bg-black/50 border border-white/10 rounded px-2 py-1 text-xs"
          value={kit}
          onChange={(e) => {
            const id = e.target.value;
            setKit(id);
            void bootKit(toonUrl(id), `${id}.glb`);
          }}
        >
          {kits.map((id) => (
            <option key={id} value={id}>
              {id} · {TOON_PLAY_KITS[id].heightM} m
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn ghost text-[11px] flex items-center gap-1"
          onClick={() => fileRef.current?.click()}
        >
          <FolderOpen size={12} /> Open GLB
        </button>
        <button
          type="button"
          className="btn ghost text-[11px] flex items-center gap-1"
          onClick={() => videoRef.current?.click()}
        >
          <Film size={12} /> Video plane
        </button>
        <button
          type="button"
          className="btn ghost text-[11px] flex items-center gap-1"
          onClick={() => void bootKit(toonUrl(kit), `${kit}.glb`)}
        >
          <RotateCcw size={12} /> Reload kit
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".glb,.gltf,.fbx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const path = (f as File & { path?: string }).path;
            const url = URL.createObjectURL(f);
            void bootKit(url, f.name, path);
            e.target.value = "";
          }}
        />
        <input
          ref={videoRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const url = URL.createObjectURL(f);
            runtimeRef.current?.attachVideo(url);
            toast.success("Video plane", { description: f.name });
            e.target.value = "";
          }}
        />
        <label className="text-[10px] uppercase tracking-wide text-slate-500">Move m/s</label>
        <input
          type="range"
          min={1}
          max={10}
          step={0.1}
          value={settings.moveSpeed}
          onChange={(e) => setSettings((s) => ({ ...s, moveSpeed: Number(e.target.value) }))}
        />
        <label className="text-[10px] uppercase tracking-wide text-slate-500">Look sens</label>
        <input
          type="range"
          min={0.0008}
          max={0.006}
          step={0.0001}
          value={settings.mouseSens}
          onChange={(e) => setSettings((s) => ({ ...s, mouseSens: Number(e.target.value) }))}
        />
        <button
          type="button"
          className="btn ghost text-[11px] flex items-center gap-1"
          onClick={() => setHelp((h) => !h)}
        >
          <HelpCircle size={12} /> Hotkeys
        </button>
      </aside>

      <div className="flex-1 min-w-0 relative">
        <div ref={hostRef} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs gap-2">
            <Loader2 size={14} className="animate-spin" /> {status}
          </div>
        )}
        {hud && (
          <div className="absolute left-3 bottom-3 text-[11px] bg-black/55 border border-white/10 rounded px-3 py-2 pointer-events-none">
            <div className="text-emerald-300 font-semibold">PLAY</div>
            <div>{status}</div>
            <div>{si}</div>
            <div>
              gait {gait} · clip {clipName} · {locked ? "look locked" : "click to look"}
            </div>
          </div>
        )}
        {help && (
          <div className="absolute right-3 top-3 w-64 text-[11px] bg-black/80 border border-white/10 rounded p-3">
            {PLAY_HOTKEYS.map((h) => (
              <div key={h.keys} className="flex justify-between gap-2 py-0.5">
                <span className="text-amber-200/90">{h.keys}</span>
                <span className="text-slate-400 text-right">{h.action}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className="w-[280px] shrink-0 border-l border-white/10 p-3 flex flex-col gap-2 min-h-0">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">Script</div>
        <textarea
          className="flex-1 min-h-[140px] bg-black/50 border border-white/10 rounded p-2 text-[11px] font-mono"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          spellCheck={false}
        />
        <div className="flex gap-2">
          <button type="button" className="btn ghost text-[11px] flex-1" onClick={() => void runScript()}>
            Run
          </button>
          <button
            type="button"
            className="btn ghost text-[11px] flex-1 flex items-center justify-center gap-1"
            disabled={aiBusy}
            onClick={() => void aiScript()}
          >
            <Wand2 size={12} /> {aiBusy ? "AI…" : "AI script"}
          </button>
        </div>
        <pre className="h-28 overflow-auto text-[10px] text-slate-500 bg-black/40 rounded p-2 whitespace-pre-wrap">
          {log || "script log"}
        </pre>
      </aside>
    </div>
  );
}
