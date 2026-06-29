import React from "react";
import {
  Play, Square, ExternalLink, FolderOpen, Loader2, Gamepad2,
  Swords, Hammer, Box, Layers, Globe,
} from "lucide-react";
import { FLEET_GAMES } from "../../shared/fleetGames";

const ENGINE_ROUTES = [
  { path: "/", label: "Portal home", icon: Globe },
  { path: "/pvp", label: "PvP arena", icon: Swords },
  { path: "/games", label: "Game library", icon: Gamepad2 },
  { path: "/tower-defense", label: "Tower defense", icon: Layers },
  { path: "/avernus-3d", label: "Avernus 3D", icon: Box },
  { path: "/grudge-editor", label: "Grudge editor", icon: Hammer },
  { path: "/asset-pipeline", label: "Asset pipeline", icon: Box },
  { path: "/annihilate-demo", label: "6-race combat demo", icon: Swords },
];

interface Props {
  engineStatus: any;
  engineRoot: string;
  enginePort: number;
  busy: boolean;
  onRootChange: (v: string) => void;
  onPortChange: (v: number) => void;
  onPickRoot: () => void;
  onLaunch: () => void;
  onStop: () => void;
  onOpenForge: () => void;
  onOpenBrowser: (prefix: string) => void;
}

export default function EngineHub({
  engineStatus,
  engineRoot,
  enginePort,
  busy,
  onRootChange,
  onPortChange,
  onPickRoot,
  onLaunch,
  onStop,
  onOpenForge,
  onOpenBrowser,
}: Props) {
  const base = engineStatus?.running
    ? `http://localhost:${engineStatus.port ?? enginePort}`
    : "https://grudge-studio.com";

  const engineGame = FLEET_GAMES.find((g) => g.id === "the-engine");

  return (
    <div className="engine-hub">
      <div className="card engine-card">
        <h3 className="text-sm font-semibold text-gold mb-2">The-ENGINE (GitHub)</h3>
        <p className="muted text-xs mb-3">
          Native hub — launch your local checkout or open production routes in the browser.
          Character viewer and VFX run in-process via Three.js (no iframe).
        </p>
        <div className="space-y-2 mb-3">
          <label className="block text-xs">
            <span className="text-muted">Repo root</span>
            <div className="flex gap-1 mt-1">
              <input className="flex-1 text-xs" value={engineRoot} onChange={(e) => onRootChange(e.target.value)} placeholder="Desktop\The-ENGINE" />
              <button type="button" className="btn ghost text-xs" onClick={onPickRoot}><FolderOpen size={12} /></button>
            </div>
          </label>
          <label className="block text-xs">
            <span className="text-muted">Dev port</span>
            <input className="w-20 mt-1" type="number" value={enginePort} onChange={(e) => onPortChange(Number(e.target.value))} />
          </label>
        </div>
        <div className="flex gap-2 flex-wrap mb-2">
          {!engineStatus?.running ? (
            <button type="button" className="btn text-xs flex items-center gap-1" onClick={onLaunch} disabled={busy}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Launch local
            </button>
          ) : (
            <>
              <button type="button" className="btn text-xs" onClick={() => window.grudge.engine.open("/")}><ExternalLink size={12} /> Open :{engineStatus.port}</button>
              <button type="button" className="btn text-xs bg-red-900/30" onClick={onStop} disabled={busy}><Square size={12} /> Stop</button>
            </>
          )}
          {engineGame?.url && (
            <button type="button" className="btn ghost text-xs" onClick={() => window.grudge.os.openExternal(engineGame.url)}>
              <Globe size={12} /> Production
            </button>
          )}
        </div>
        {engineStatus?.error && <p className="text-[10px] text-red-400">{engineStatus.error}</p>}
        <p className="muted text-[10px] mt-2 font-mono">Active base: {base}</p>
      </div>

      <div className="card engine-card">
        <h3 className="text-xs font-semibold text-gold mb-2">Dev tool shortcuts</h3>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn ghost text-xs" onClick={onOpenForge}>Forge 3D</button>
          <button type="button" className="btn ghost text-xs" onClick={() => onOpenBrowser("factioncharacters/")}>R2 characters</button>
          <button type="button" className="btn ghost text-xs" onClick={() => onOpenBrowser("asset-packs/weapons/")}>R2 weapons</button>
          <button type="button" className="btn ghost text-xs" onClick={() => onOpenBrowser("asset-packs/vfx/")}>R2 VFX</button>
        </div>
      </div>

      <div className="card engine-card">
        <h3 className="text-xs font-semibold text-gold mb-2">Portal routes</h3>
        <div className="engine-route-list">
          {ENGINE_ROUTES.map((r) => (
            <button
              key={r.path}
              type="button"
              className="engine-route-row"
              onClick={() => window.grudge.os.openExternal(`${base}${r.path}`)}
            >
              <r.icon size={12} className="text-gold shrink-0" />
              <span className="text-xs flex-1 text-left">{r.label}</span>
              <span className="font-mono text-[9px] text-muted">{r.path}</span>
              <ExternalLink size={10} className="opacity-40" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}