import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Shield, Car, Gamepad2, X, Coins, Heart, Swords, Gauge, Swords as Blade, Keyboard,
} from "lucide-react";
import { TowerDefenseDemo } from "../lib/forge/towerDefenseDemo";
import { DriveDemo } from "../lib/forge/driveDemo";
import { ArenaDemo } from "../lib/forge/arenaDemo";

type ActiveMode = null | "tower" | "drive" | "arena";
type TowerKey = "arrow" | "magic" | "cannon" | "fire";

const TOWER_BTNS: { key: TowerKey; label: string; cost: number; hotkey: string }[] = [
  { key: "arrow", label: "Arrow", cost: 50, hotkey: "1" },
  { key: "magic", label: "Magic", cost: 80, hotkey: "2" },
  { key: "cannon", label: "Cannon", cost: 100, hotkey: "3" },
  { key: "fire", label: "Fire", cost: 90, hotkey: "4" },
];

export default function GameModes({ embedded = false }: { embedded?: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const demoRef = useRef<{ dispose: () => void; setTowerType?: (t: TowerKey) => void } | null>(null);
  const [active, setActive] = useState<ActiveMode>(null);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [towerType, setTowerType] = useState<TowerKey>("arrow");

  function stopDemo() {
    demoRef.current?.dispose();
    demoRef.current = null;
    setActive(null);
    setStats({});
  }

  useEffect(() => () => stopDemo(), []);

  function selectTower(t: TowerKey) {
    setTowerType(t);
    demoRef.current?.setTowerType?.(t);
  }

  function launchTower() {
    stopDemo();
    if (!viewportRef.current) return;
    const demo = new TowerDefenseDemo(viewportRef.current);
    demo.onStats = (s) => setStats(s);
    demo.setTowerType(towerType);
    demoRef.current = demo;
    setActive("tower");
    toast.success("Tower Defense — click grid to place · keys 1–4 select type");
  }

  function launchDrive() {
    stopDemo();
    if (!viewportRef.current) return;
    const demo = new DriveDemo(viewportRef.current);
    demo.onStats = (s) => setStats(s);
    demoRef.current = demo;
    setActive("drive");
    toast.success("Grudge Drive — WASD to drive, Shift to boost");
  }

  function launchArena() {
    stopDemo();
    if (!viewportRef.current) return;
    const demo = new ArenaDemo(viewportRef.current);
    demo.onStats = (s) => setStats(s);
    demoRef.current = demo;
    setActive("arena");
    toast.success("Arena Skirmish — WASD move, click/Space strike, Shift+drag look");
  }

  return (
    <div className="flex flex-col h-full">
      <div className={`flex items-center gap-4 px-4 py-2 border-b border-line ${embedded ? "bg-bg-2/30" : "bg-bg-2/50"}`}>
        {!embedded && (
          <>
            <Gamepad2 size={18} className="text-gold" />
            <span className="font-semibold text-sm">Play Modes</span>
          </>
        )}
        {embedded && active === null && (
          <span className="text-xs text-muted">Tower Defense · Grudge Drive · Arena — client-side Three.js</span>
        )}

        {active === null ? (
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <button className="btn flex items-center gap-2 text-xs" onClick={launchTower}>
              <Shield size={14} /> Tower Defense
            </button>
            <button className="btn flex items-center gap-2 text-xs" onClick={launchDrive}>
              <Car size={14} /> Grudge Drive
            </button>
            <button className="btn flex items-center gap-2 text-xs" onClick={launchArena}>
              <Blade size={14} /> Arena Skirmish
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 ml-auto flex-wrap">
            {active === "tower" && (
              <>
                <span className="flex items-center gap-1 text-xs text-gold"><Coins size={12} />{stats.gold ?? 0}</span>
                <span className="flex items-center gap-1 text-xs text-red-400"><Heart size={12} />{stats.lives ?? 0}</span>
                <span className="flex items-center gap-1 text-xs text-muted"><Swords size={12} />Wave {stats.wave ?? 0}</span>
                <span className="text-xs text-muted">{stats.enemies ?? 0} enemies</span>
                <div className="flex items-center gap-1 border-l border-line pl-2">
                  {TOWER_BTNS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        towerType === t.key ? "border-gold text-gold bg-gold/10" : "border-line text-muted"
                      }`}
                      onClick={() => selectTower(t.key)}
                      title={`${t.label} (${t.cost}g) — hotkey ${t.hotkey}`}
                    >
                      {t.hotkey}:{t.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {active === "drive" && (
              <>
                <span className="flex items-center gap-1 text-xs text-gold"><Gauge size={12} />{stats.speed ?? 0} km/h</span>
                <span className="text-xs text-muted">Lap {stats.lap ?? 0}</span>
              </>
            )}
            {active === "arena" && (
              <>
                <span className="flex items-center gap-1 text-xs text-red-400"><Heart size={12} />{stats.hp ?? 0}</span>
                <span className="flex items-center gap-1 text-xs text-gold"><Swords size={12} />{stats.kills ?? 0} kills</span>
                <span className="text-xs text-muted">Wave {stats.wave ?? 0}</span>
                <span className="text-xs text-muted">{stats.enemies ?? 0} left</span>
              </>
            )}
            <button
              className="btn flex items-center gap-1 text-xs bg-red-900/30 border-red-800 hover:bg-red-900/50"
              onClick={stopDemo}
            >
              <X size={12} /> Exit
            </button>
          </div>
        )}
      </div>

      <div ref={viewportRef} className="flex-1 relative" style={{ minHeight: 300 }}>
        {active === null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 text-muted overflow-auto py-6">
            <Gamepad2 size={48} className="text-gold/30" />
            <div className="text-center max-w-md space-y-2 px-4">
              <h2 className="text-lg font-semibold text-gold">Play Mode Showcase</h2>
              <p className="text-sm">
                Playable 3D prototypes on the Forge Three.js stack. No server required —
                ideal for validating camera, combat, and placement loops before shipping a full game.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl w-full px-4">
              <button
                onClick={launchTower}
                className="card hover:border-gold/50 transition-colors text-left cursor-pointer"
              >
                <Shield size={24} className="text-gold mb-2" />
                <div className="font-semibold text-sm">Tower Defense</div>
                <div className="text-xs text-muted mt-1">
                  Click the grid to place towers. Keys 1–4 pick Arrow, Magic, Cannon, Fire.
                  Waves scale enemies and gold rewards.
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted mt-2">
                  <Keyboard size={10} /> Click · 1–4
                </div>
              </button>
              <button
                onClick={launchDrive}
                className="card hover:border-gold/50 transition-colors text-left cursor-pointer"
              >
                <Car size={24} className="text-gold mb-2" />
                <div className="font-semibold text-sm">Grudge Drive</div>
                <div className="text-xs text-muted mt-1">
                  WASD racing on a circular track. Over-shoulder camera, Shift boost,
                  lap counter, scenery markers.
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted mt-2">
                  <Keyboard size={10} /> WASD · Shift
                </div>
              </button>
              <button
                onClick={launchArena}
                className="card hover:border-gold/50 transition-colors text-left cursor-pointer"
              >
                <Blade size={24} className="text-gold mb-2" />
                <div className="font-semibold text-sm">Arena Skirmish</div>
                <div className="text-xs text-muted mt-1">
                  Third-person combat sandbox. Strike dummies, survive waves.
                  Shift+drag to orbit the camera.
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted mt-2">
                  <Keyboard size={10} /> WASD · Space · Click
                </div>
              </button>
            </div>
          </div>
        )}
        {active !== null && (
          <div className="absolute bottom-3 left-3 z-10 text-[10px] text-muted bg-bg-2/80 border border-line rounded px-2 py-1 max-w-xs pointer-events-none">
            {active === "tower" && "Click empty tile to place · 1–4 tower type · orbit drag to pan"}
            {active === "drive" && "W/S throttle · A/D steer · Shift boost"}
            {active === "arena" && "WASD move · click/Space strike · Shift+drag look"}
          </div>
        )}
      </div>
    </div>
  );
}
