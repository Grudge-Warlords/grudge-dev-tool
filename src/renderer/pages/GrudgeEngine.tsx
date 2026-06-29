import React, { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Cpu, Users, Sparkles, Hammer, Box, ChevronRight, FolderOpen, Layers,
} from "lucide-react";
import {
  CHARACTER_PREFABS,
  PREFAB_STATS,
  type CharacterPrefab,
  type RaceId,
} from "../../shared/characterCatalog";
import {
  GRUDGE6_ASSET_ROOTS,
  cdnUrl,
  type AssetCategory,
} from "../../shared/grudge6Assets";
import { openRemoteInForge } from "../lib/openInForge";
import { useWorkspaceField } from "../lib/useWorkspaceField";
import CharacterViewport from "../components/CharacterViewport";
import EngineHub from "../components/EngineHub";

type EngineTab = "portal" | "characters" | "vfx";

const RACES: RaceId[] = ["human", "barbarian", "elf", "dwarf", "orc", "undead"];

export default function GrudgeEngine() {
  const [tab, setTab] = useState<EngineTab>("characters");
  const [engineStatus, setEngineStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [engineRoot, setEngineRoot] = useWorkspaceField("engineRoot", "");
  const [enginePort, setEnginePort] = useWorkspaceField("enginePort", 5000);
  const [selectedPrefab, setSelectedPrefab] = useState<CharacterPrefab>(CHARACTER_PREFABS[0]);
  const [assetCategory, setAssetCategory] = useState<AssetCategory>("characters");
  const [r2Prefix, setR2Prefix] = useState("factioncharacters/");
  const [attachedWeapon, setAttachedWeapon] = useState<string | null>(null);

  const refreshEngine = useCallback(async () => {
    try {
      setEngineStatus(await window.grudge.engine.status());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshEngine();
    const t = setInterval(refreshEngine, 6000);
    return () => clearInterval(t);
  }, [refreshEngine]);

  useEffect(() => {
    const root = GRUDGE6_ASSET_ROOTS.find((r) => r.id === assetCategory);
    if (root) setR2Prefix(root.r2Prefix);
  }, [assetCategory]);

  const { data: r2List, isLoading: r2Loading } = useQuery({
    queryKey: ["engine.r2", r2Prefix],
    queryFn: () => window.grudge.os.list({ prefix: r2Prefix, delimiter: "/", limit: 120 }),
    enabled: tab !== "portal",
  });

  async function pickEngineRoot() {
    const picked = await window.grudge.engine.pickRoot();
    if (!picked) return;
    setEngineRoot(picked);
    await window.grudge.engine.setPrefs({ engineRoot: picked });
    toast.success("The-ENGINE root saved");
  }

  async function launchEngine() {
    setBusy(true);
    try {
      await window.grudge.engine.setPrefs({ engineRoot, enginePort });
      const s = await window.grudge.engine.launch({ port: enginePort, engineRoot: engineRoot || undefined });
      setEngineStatus(s);
      if (s.running) toast.success(`Engine on :${s.port}`);
      else if (s.error) toast.error("Engine launch failed", { description: s.error });
    } catch (e: any) {
      toast.error("Launch failed", { description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  async function stopEngine() {
    setBusy(true);
    try {
      setEngineStatus(await window.grudge.engine.stop());
      toast.success("Engine stopped");
    } finally {
      setBusy(false);
    }
  }

  function selectPrefab(p: CharacterPrefab) {
    setSelectedPrefab(p);
    if (tab === "portal") setTab("characters");
  }

  async function openR2InForge(key: string) {
    try {
      await openRemoteInForge(cdnUrl(key));
      toast.success("Opened in Forge 3D");
    } catch (e: any) {
      toast.error("Forge open failed", { description: e?.message });
    }
  }

  function attachWeaponFromR2(key: string) {
    setAttachedWeapon(key);
    toast.success("Weapon attached to viewport");
  }

  return (
    <div className="engine-page">
      <header className="engine-hero">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Cpu size={22} className="text-gold" />
            Grudge Engine
          </h1>
          <p className="muted text-sm max-w-2xl">
            Native Grudge6 character viewer (Three.js), VFX playground, and The-ENGINE hub —
            R2 library and Forge wired in-process. No iframe embeds.
          </p>
        </div>
        <div className="engine-hero-stats muted text-xs">
          <span>{PREFAB_STATS.races} races</span>
          <span>·</span>
          <span>{PREFAB_STATS.classes} classes</span>
          <span>·</span>
          <span>{PREFAB_STATS.total} characters</span>
        </div>
      </header>

      <div className="engine-tabs">
        {([
          { id: "characters" as const, label: "Character viewer", Icon: Users },
          { id: "vfx" as const, label: "VFX playground", Icon: Sparkles },
          { id: "portal" as const, label: "Engine hub", Icon: Layers },
        ]).map(({ id, label, Icon }) => (
          <button key={id} type="button" className={`engine-tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div className="engine-layout">
        <aside className="engine-sidebar">
          {tab === "portal" ? (
            <EngineHub
              engineStatus={engineStatus}
              engineRoot={engineRoot}
              enginePort={enginePort}
              busy={busy}
              onRootChange={setEngineRoot}
              onPortChange={setEnginePort}
              onPickRoot={pickEngineRoot}
              onLaunch={launchEngine}
              onStop={stopEngine}
              onOpenForge={() => window.grudge.app.openRoute("/forge")}
              onOpenBrowser={(prefix) => {
                window.grudge.app.openRoute("/browser");
                void window.grudge.workspace?.patch?.({ browserPrefix: prefix });
              }}
            />
          ) : (
            <>
              <div className="card engine-card">
                <h3 className="text-xs font-semibold text-gold mb-2">Grudge6 races</h3>
                <div className="engine-race-grid">
                  {RACES.map((race) => (
                    <button
                      key={race}
                      type="button"
                      className={`engine-race-btn ${selectedPrefab.race === race ? "active" : ""}`}
                      onClick={() => {
                        const first = CHARACTER_PREFABS.find((p) => p.race === race);
                        if (first) selectPrefab(first);
                      }}
                    >
                      <span className="capitalize">{race}</span>
                      <span className="text-[9px] opacity-60">4</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="card engine-card engine-prefab-list">
                <h3 className="text-xs font-semibold text-gold mb-2">Classes · {selectedPrefab.race}</h3>
                <div className="space-y-1 max-h-40 overflow-auto">
                  {CHARACTER_PREFABS.filter((p) => p.race === selectedPrefab.race).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`engine-prefab-row w-full text-left ${selectedPrefab.id === p.id ? "active" : ""}`}
                      onClick={() => selectPrefab(p)}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.classColor }} />
                      <span className="text-xs truncate flex-1">{p.name}</span>
                      <ChevronRight size={10} className="opacity-40" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="card engine-card">
                <h3 className="text-xs font-semibold text-gold mb-2 flex items-center gap-1">
                  <Box size={12} /> R2 library
                </h3>
                <div className="flex flex-wrap gap-1 mb-2">
                  {GRUDGE6_ASSET_ROOTS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`engine-chip ${assetCategory === r.id ? "active" : ""}`}
                      onClick={() => setAssetCategory(r.id)}
                      title={r.description}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <p className="muted text-[9px] mb-2 font-mono truncate">{r2Prefix}</p>
                <div className="engine-r2-list max-h-36 overflow-auto">
                  {r2Loading && <div className="text-[10px] text-muted">Loading R2…</div>}
                  {r2List?.folders?.slice(0, 12).map((f: string) => (
                    <button key={f} type="button" className="engine-r2-row" onClick={() => setR2Prefix(f)}>
                      <FolderOpen size={10} /> {f.replace(r2Prefix, "").replace(/\/$/, "") || f}
                    </button>
                  ))}
                  {r2List?.items?.filter((i: { name: string }) => /\.(glb|gltf|fbx)$/i.test(i.name)).slice(0, 10).map((i: { name: string }) => {
                    const fullKey = r2Prefix + i.name;
                    return (
                      <div key={i.name} className="engine-r2-row flex justify-between gap-1 items-center">
                        <button type="button" className="truncate text-[10px] flex-1 text-left" onClick={() => attachWeaponFromR2(fullKey)}>
                          {i.name}
                        </button>
                        <button type="button" className="btn ghost text-[9px] px-1" onClick={() => openR2InForge(fullKey)} title="Forge">
                          <Hammer size={9} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="card engine-card text-[10px]">
                <div className="font-semibold text-gold mb-1">{selectedPrefab.name}</div>
                <p className="muted leading-snug mb-2">{selectedPrefab.lore}</p>
                <div className="muted font-mono text-[9px] break-all">{selectedPrefab.modelPath}</div>
                <button type="button" className="btn ghost text-xs w-full mt-2" onClick={() => openR2InForge(selectedPrefab.modelPath)}>
                  <Hammer size={11} /> Open in Forge
                </button>
              </div>
            </>
          )}
        </aside>

        <section className="engine-main">
          {tab === "portal" ? (
            <div className="engine-native-panel card">
              <h3 className="text-sm font-semibold text-gold mb-2">Integrated engine hub</h3>
              <p className="muted text-xs mb-4">
                Use the sidebar to launch The-ENGINE locally or jump to portal routes.
                Character preview and VFX run natively in the other tabs — same Three.js stack as Forge.
              </p>
              <ul className="engine-steps muted text-xs space-y-2">
                <li>1. <strong className="text-ink">Character viewer</strong> — 24 Grudge6 prefabs, CDN GLB + animations</li>
                <li>2. <strong className="text-ink">VFX playground</strong> — particle aura + class-colored effects</li>
                <li>3. <strong className="text-ink">R2 attach</strong> — click a weapon GLB to parent on character</li>
                <li>4. <strong className="text-ink">Forge</strong> — one-click edit any R2 asset</li>
              </ul>
            </div>
          ) : (
            <CharacterViewport
              prefab={selectedPrefab}
              weaponR2Key={attachedWeapon}
              vfxMode={tab === "vfx"}
            />
          )}
        </section>
      </div>
    </div>
  );
}