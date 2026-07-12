/**
 * Create → Engine tab
 *
 * Native Grudge6 character viewer: canonical race GLBs + live mesh equipment
 * (same Units_* child-mesh system as Warlords UMMORPG).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Cpu, Users, Sparkles, Hammer, Box, ChevronRight, FolderOpen, Layers, Shirt,
} from "lucide-react";
import {
  CHARACTER_PREFABS,
  PREFAB_STATS,
  type CharacterPrefab,
  type EquipmentSlots,
  type RaceId,
} from "../../shared/characterCatalog";
import {
  GRUDGE6_ASSET_ROOTS,
  RACE_GRUDGE6,
  cdnUrl,
  type AssetCategory,
} from "../../shared/grudge6Assets";
import { openRemoteInForge } from "../lib/openInForge";
import { useWorkspaceField } from "../lib/useWorkspaceField";
import CharacterViewport, { type EquipOverride } from "../components/CharacterViewport";
import EngineHub from "../components/EngineHub";

type EngineTab = "portal" | "characters" | "vfx" | "equip";

const RACES: RaceId[] = ["human", "barbarian", "elf", "dwarf", "orc", "undead"];

const ARMOR_SLOTS: { key: keyof EquipmentSlots; label: string; variants: string[] }[] = [
  { key: "body", label: "Body", variants: ["A", "B", "C", "D", "E"] },
  { key: "arms", label: "Arms", variants: ["A", "B", "C", "D", "E"] },
  { key: "legs", label: "Legs", variants: ["A", "B", "C", "D", "E"] },
  { key: "head", label: "Head", variants: ["none", "A", "B", "C", "D"] },
  { key: "shoulders", label: "Shoulders", variants: ["none", "A", "B", "C"] },
];

const WEAPON_PRESETS: {
  id: string;
  label: string;
  rightHand: string | null;
  rightHandType: string | null;
  leftHand: string | null;
  leftHandType: string | null;
  shield: string | null;
}[] = [
  { id: "unarmed", label: "Unarmed", rightHand: null, rightHandType: null, leftHand: null, leftHandType: null, shield: null },
  { id: "sword", label: "Sword", rightHand: "A", rightHandType: "sword", leftHand: null, leftHandType: null, shield: null },
  { id: "sword_shield", label: "Sword+Shield", rightHand: "A", rightHandType: "sword", leftHand: null, leftHandType: null, shield: "A" },
  { id: "axe", label: "Axe", rightHand: "A", rightHandType: "axe", leftHand: null, leftHandType: null, shield: null },
  { id: "hammer", label: "Hammer", rightHand: "A", rightHandType: "hammer", leftHand: null, leftHandType: null, shield: null },
  { id: "staff", label: "Staff", rightHand: null, rightHandType: null, leftHand: "A", leftHandType: "staff", shield: null },
  { id: "bow", label: "Bow", rightHand: null, rightHandType: null, leftHand: null, leftHandType: "bow", shield: null },
  { id: "spear", label: "Spear", rightHand: null, rightHandType: null, leftHand: null, leftHandType: "spear", shield: null },
];

function equipmentFromPrefab(p: CharacterPrefab): EquipmentSlots {
  return {
    body: p.equipment.body,
    arms: p.equipment.arms,
    legs: p.equipment.legs,
    head: p.equipment.head,
    shoulders: p.equipment.shoulders,
    rightHand: p.equipment.rightHand,
    rightHandType: p.equipment.rightHandType,
    leftHand: p.equipment.leftHand,
    leftHandType: p.equipment.leftHandType,
    shield: p.equipment.shield,
    utility: [...(p.equipment.utility ?? [])],
  };
}

export default function GrudgeEngine() {
  const [tab, setTab] = useState<EngineTab>("characters");
  const [engineStatus, setEngineStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [engineRoot, setEngineRoot] = useWorkspaceField("engineRoot", "");
  const [enginePort, setEnginePort] = useWorkspaceField("enginePort", 5000);
  const [selectedPrefab, setSelectedPrefab] = useState<CharacterPrefab>(CHARACTER_PREFABS[0]);
  const [assetCategory, setAssetCategory] = useState<AssetCategory>("characters");
  const [r2Prefix, setR2Prefix] = useState("models/grudge6/races/");
  const [liveEquip, setLiveEquip] = useState<EquipmentSlots>(() =>
    equipmentFromPrefab(CHARACTER_PREFABS[0]),
  );
  const [slotSummary, setSlotSummary] = useState<Record<string, string[]>>({});
  const [weaponPreset, setWeaponPreset] = useState("sword_shield");

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

  function selectPrefab(p: CharacterPrefab) {
    setSelectedPrefab(p);
    setLiveEquip(equipmentFromPrefab(p));
    // Match class default weapon
    if (p.classId === "warrior") setWeaponPreset("sword_shield");
    else if (p.classId === "mage") setWeaponPreset("staff");
    else if (p.classId === "ranger") setWeaponPreset("bow");
    else if (p.classId === "worge") setWeaponPreset("axe");
    if (tab === "portal") setTab("characters");
  }

  function setArmorSlot(key: keyof EquipmentSlots, value: string) {
    setLiveEquip((prev) => {
      if (key === "utility") return prev;
      if (key === "head" || key === "shoulders" || key === "shield") {
        return { ...prev, [key]: value === "none" ? null : value };
      }
      if (key === "body" || key === "arms" || key === "legs") {
        return { ...prev, [key]: value };
      }
      return prev;
    });
  }

  function applyWeaponPreset(id: string) {
    setWeaponPreset(id);
    const preset = WEAPON_PRESETS.find((w) => w.id === id);
    if (!preset) return;
    setLiveEquip((prev) => ({
      ...prev,
      rightHand: preset.rightHand,
      rightHandType: preset.rightHandType,
      leftHand: preset.leftHand,
      leftHandType: preset.leftHandType,
      shield: preset.shield,
    }));
  }

  function cycleVariant(slot: string) {
    const available = slotSummary[slot];
    if (!available?.length) return;
    setLiveEquip((prev) => {
      const current =
        slot === "body" ? prev.body
        : slot === "arms" ? prev.arms
        : slot === "legs" ? prev.legs
        : slot === "head" ? (prev.head ?? "none")
        : slot === "shoulders" ? (prev.shoulders ?? "none")
        : null;
      if (current === null && slot !== "head" && slot !== "shoulders") return prev;
      const idx = available.indexOf(String(current));
      const next = available[(idx + 1) % available.length];
      if (slot === "body" || slot === "arms" || slot === "legs") {
        return { ...prev, [slot]: next };
      }
      if (slot === "head" || slot === "shoulders") {
        return { ...prev, [slot]: next };
      }
      return prev;
    });
  }

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

  async function openR2InForge(key: string) {
    try {
      await openRemoteInForge(cdnUrl(key));
      toast.success("Opened in Forge 3D");
    } catch (e: any) {
      toast.error("Forge open failed", { description: e?.message });
    }
  }

  const raceCfg = RACE_GRUDGE6[selectedPrefab.race] ?? RACE_GRUDGE6.human;
  const equipOverride: EquipOverride = liveEquip;

  const catalogHint = useMemo(() => {
    const slots = Object.keys(slotSummary);
    if (!slots.length) return "Load a race to catalog Units_* meshes";
    return `${slots.length} slots · ${Object.values(slotSummary).reduce((n, v) => n + v.length, 0)} variants`;
  }, [slotSummary]);

  return (
    <div className="engine-page">
      <header className="engine-hero">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Cpu size={22} className="text-gold" />
            Grudge Engine
          </h1>
          <p className="muted text-sm max-w-2xl">
            Canonical Grudge6 race kits + live child-mesh equipment (Warlords-style).
            Change armor/weapon variants — the mesh updates in the viewport. No toon-shooter placeholders.
          </p>
        </div>
        <div className="engine-hero-stats muted text-xs">
          <span>{PREFAB_STATS.races} races</span>
          <span>·</span>
          <span>{PREFAB_STATS.classes} classes</span>
          <span>·</span>
          <span>{PREFAB_STATS.total} prefabs</span>
          <span>·</span>
          <span className="text-gold">models/grudge6/races/</span>
        </div>
      </header>

      <div className="engine-tabs">
        {([
          { id: "characters" as const, label: "Character viewer", Icon: Users },
          { id: "equip" as const, label: "Equipment test", Icon: Shirt },
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
                      <span className="text-[9px] opacity-60">{RACE_GRUDGE6[race].prefix}</span>
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

              {(tab === "equip" || tab === "characters" || tab === "vfx") && (
                <div className="card engine-card">
                  <h3 className="text-xs font-semibold text-gold mb-2 flex items-center gap-1">
                    <Shirt size={12} /> Mesh equipment
                  </h3>
                  <p className="muted text-[9px] mb-2">{catalogHint}</p>

                  <div className="space-y-2 mb-3">
                    {ARMOR_SLOTS.map(({ key, label, variants }) => {
                      const raw =
                        key === "body" ? liveEquip.body
                        : key === "arms" ? liveEquip.arms
                        : key === "legs" ? liveEquip.legs
                        : key === "head" ? (liveEquip.head ?? "none")
                        : key === "shoulders" ? (liveEquip.shoulders ?? "none")
                        : "A";
                      const fromCatalog = slotSummary[key as string];
                      const opts = fromCatalog?.length
                        ? (key === "head" || key === "shoulders"
                          ? ["none", ...fromCatalog]
                          : fromCatalog)
                        : variants;
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-[10px] w-16 shrink-0 text-muted">{label}</span>
                          <select
                            className="engine-select flex-1 text-[10px]"
                            value={String(raw)}
                            onChange={(e) => setArmorSlot(key, e.target.value)}
                          >
                            {opts.map((v) => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                          {fromCatalog?.length ? (
                            <button
                              type="button"
                              className="btn ghost text-[9px] px-1"
                              title="Cycle catalog variant"
                              onClick={() => cycleVariant(key)}
                            >
                              ↻
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <h4 className="text-[10px] font-semibold text-gold mb-1">Weapon</h4>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {WEAPON_PRESETS.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        className={`engine-chip ${weaponPreset === w.id ? "active" : ""}`}
                        onClick={() => applyWeaponPreset(w.id)}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="btn ghost text-xs w-full"
                    onClick={() => {
                      setLiveEquip(equipmentFromPrefab(selectedPrefab));
                      toast.message("Reset to class starting loadout");
                    }}
                  >
                    Reset to class default
                  </button>
                </div>
              )}

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
                  {r2List?.items?.filter((i: { name: string }) => /\.(glb|gltf|fbx|webp)$/i.test(i.name)).slice(0, 12).map((i: { name: string }) => {
                    const fullKey = r2Prefix + i.name;
                    return (
                      <div key={i.name} className="engine-r2-row flex justify-between gap-1 items-center">
                        <span className="truncate text-[10px] flex-1 text-left" title={fullKey}>
                          {i.name}
                        </span>
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
                <div className="muted font-mono text-[9px] break-all">{raceCfg.cdnPath}</div>
                <div className="muted text-[9px] mt-1">prefix {raceCfg.prefix} · scale {raceCfg.scale}</div>
                <button
                  type="button"
                  className="btn ghost text-xs w-full mt-2"
                  onClick={() => openR2InForge(raceCfg.cdnPath.replace(/^\//, ""))}
                >
                  <Hammer size={11} /> Open race GLB in Forge
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
                Character preview and equipment testing use the same modular race kits as
                Warlords: one GLB per race, equipment = Units_* child mesh visibility.
              </p>
              <ul className="engine-steps muted text-xs space-y-2">
                <li>1. <strong className="text-ink">Character viewer</strong> — 6 race GLBs from models/grudge6/races/</li>
                <li>2. <strong className="text-ink">Equipment test</strong> — swap body/arms/legs/weapons live</li>
                <li>3. <strong className="text-ink">VFX playground</strong> — particle aura on race kit</li>
                <li>4. <strong className="text-ink">Forge</strong> — open race GLB for mesh hierarchy inspect</li>
              </ul>
            </div>
          ) : (
            <CharacterViewport
              prefab={selectedPrefab}
              equipOverride={equipOverride}
              vfxMode={tab === "vfx"}
              onSlotSummary={setSlotSummary}
            />
          )}
        </section>
      </div>
    </div>
  );
}
