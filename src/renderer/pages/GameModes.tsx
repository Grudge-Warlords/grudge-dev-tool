import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Shield, Car, Gamepad2, X, Coins, Heart, Swords, Gauge,
} from "lucide-react";
import { TowerDefenseDemo } from "../lib/forge/towerDefenseDemo";
import { DriveDemo } from "../lib/forge/driveDemo";

type ActiveMode = null | "tower" | "drive";

export default function GameModes({ embedded = false }: { embedded?: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const demoRef = useRef<{ dispose: () => void } | null>(null);
  const [active, setActive] = useState<ActiveMode>(null);
  const [stats, setStats] = useState<Record<string, any>>({});

  // Tear down any running demo
  function stopDemo() {
    demoRef.current?.dispose();
    demoRef.current = null;
    setActive(null);
    setStats({});
  }

  useEffect(() => () => stopDemo(), []);

  function launchTower() {
    stopDemo();
    if (!viewportRef.current) return;
    const demo = new TowerDefenseDemo(viewportRef.current);
    demo.onStats = (s) => setStats(s);
    demoRef.current = demo;
    setActive("tower");
    toast.success("Tower Defense started");
  }

  function launchDrive() {
    stopDemo();
    if (!viewportRef.current) return;
    const demo = new DriveDemo(viewportRef.current);
    demo.onStats = (s) => setStats(s);
    demoRef.current = demo;
    setActive("drive");
    toast.success("Grudge Drive started — WASD to drive, Shift to boost");
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className={`flex items-center gap-4 px-4 py-2 border-b border-line ${embedded ? "bg-bg-2/30" : "bg-bg-2/50"}`}>
        {!embedded && (
          <>
            <Gamepad2 size={18} className="text-gold" />
            <span className="font-semibold text-sm">Game Modes</span>
          </>
        )}
        {embedded && active === null && (
          <span className="text-xs text-muted">Tower Defense · Grudge Drive — client-side Three.js</span>
        )}

        {active === null ? (
          <div className="flex items-center gap-2 ml-auto">
            <button className="btn flex items-center gap-2 text-xs" onClick={launchTower}>
              <Shield size={14} /> Tower Defense
            </button>
            <button className="btn flex items-center gap-2 text-xs" onClick={launchDrive}>
              <Car size={14} /> Grudge Drive
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 ml-auto">
            {/* Live stats HUD */}
            {active === "tower" && (
              <>
                <span className="flex items-center gap-1 text-xs text-gold"><Coins size={12} />{stats.gold ?? 0}</span>
                <span className="flex items-center gap-1 text-xs text-red-400"><Heart size={12} />{stats.lives ?? 0}</span>
                <span className="flex items-center gap-1 text-xs text-muted"><Swords size={12} />Wave {stats.wave ?? 0}</span>
                <span className="text-xs text-muted">{stats.enemies ?? 0} enemies</span>
              </>
            )}
            {active === "drive" && (
              <>
                <span className="flex items-center gap-1 text-xs text-gold"><Gauge size={12} />{stats.speed ?? 0} km/h</span>
                <span className="text-xs text-muted">Lap {stats.lap ?? 0}</span>
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

      {/* Viewport */}
      <div
        ref={viewportRef}
        className="flex-1 relative"
        style={{ minHeight: 300 }}
      >
        {active === null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 text-muted">
            <Gamepad2 size={48} className="text-gold/30" />
            <div className="text-center max-w-md space-y-2">
              <h2 className="text-lg font-semibold text-gold">Game Mode Showcase</h2>
              <p className="text-sm">
                Playable 3D prototypes built with the Forge engine. Tower Defense
                uses the GrudgeBuilder tower/enemy system with craftpix-style tower
                meshes. Grudge Drive demonstrates the over-shoulder camera and
                mount/vehicle physics.
              </p>
              <p className="text-xs text-muted">
                Pick a mode above to launch. These run entirely client-side in
                Three.js — no server required.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 max-w-lg w-full px-4">
              <button
                onClick={launchTower}
                className="card hover:border-gold/50 transition-colors text-left cursor-pointer"
              >
                <Shield size={24} className="text-gold mb-2" />
                <div className="font-semibold text-sm">Tower Defense</div>
                <div className="text-xs text-muted mt-1">
                  Place towers, defend against waves. Arrow, Magic, Cannon, Fire
                  tower types. Auto-targeting + projectiles. Enemies scale per wave.
                </div>
              </button>
              <button
                onClick={launchDrive}
                className="card hover:border-gold/50 transition-colors text-left cursor-pointer"
              >
                <Car size={24} className="text-gold mb-2" />
                <div className="font-semibold text-sm">Grudge Drive</div>
                <div className="text-xs text-muted mt-1">
                  WASD racing on a circular track. Over-shoulder camera follows
                  behind. Shift to boost. Trees + border markers. Lap counter.
                </div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
