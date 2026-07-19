export type ForgeRoute =
  | "/browser" | "/search" | "/upload" | "/request"
  | "/uuid" | "/library" | "/forge" | "/coder" | "/games" | "/legion"
  | "/preview" | "/local-assets" | "/playcanvas" | "/docs" | "/settings";

export interface AssetGrouping {
  id: string;
  label: string;
  query: string;
  category?: string;
  prefix?: string;
  description: string;
}

export interface RecentUploadRecord {
  fileName: string;
  objectPath: string;
  status: string;
  bytesTotal: number;
  grudgeUUID?: string;
  uploadedAt: string;
}

const NAV_EVENT = "grudge:navigate";
const PREVIEW_TARGET_KEY = "grudge:preview-target";
const REQUEST_TARGET_KEY = "grudge:request-target";
const RECENT_UPLOADS_KEY = "grudge:recent-uploads";
const RECENT_UPLOAD_LIMIT = 24;

export const ASSET_GROUPS: AssetGrouping[] = [
  { id: "warlords", label: "Warlords", query: "warlords", prefix: "asset-packs/warlords/", description: "Core Grudge Warlords asset packs and deliveries." },
  { id: "nexus", label: "Nexus", query: "nexus", prefix: "asset-packs/nexus/", description: "Shared Nexus drops and connected pack deliveries." },
  { id: "2d", label: "2D", query: "2d sprite ui icon sheet", category: "2d", prefix: "asset-packs/2d/", description: "Sprites, icons, UI sheets, cards, and 2D atlases." },
  { id: "3d", label: "3D", query: "3d model glb gltf fbx", category: "3d", prefix: "asset-packs/3d/", description: "Static meshes, rigged models, and scene props." },
  { id: "terrain", label: "Terrain", query: "terrain ground tile landscape heightmap", category: "terrain", prefix: "asset-packs/terrain/", description: "Terrain tiles, ground surfaces, cliffs, and landscape kits." },
  { id: "weapons", label: "Weapons", query: "weapon sword axe bow rifle shield", category: "weapon", prefix: "asset-packs/weapons/", description: "Weapon meshes, icons, attacks, and equipment assets." },
  { id: "characters", label: "Characters", query: "character hero npc humanoid rig", category: "character", prefix: "asset-packs/characters/", description: "Playable characters, NPCs, rigs, and hero kits." },
  { id: "monsters", label: "Monsters", query: "monster creature beast enemy rig", category: "monster", prefix: "asset-packs/monsters/", description: "Creatures, bosses, enemies, and monster animations." },
  { id: "maps", label: "Maps", query: "map scene level biome world", category: "map", prefix: "asset-packs/maps/", description: "Scenes, maps, level kits, and world chunks." },
  { id: "effects", label: "Effects", query: "effect fx shader material", category: "effects", prefix: "asset-packs/effects/", description: "General effects, shaders, and reusable effect materials." },
  { id: "vfx", label: "VFX", query: "vfx particles impact hit sparkle", category: "vfx", prefix: "asset-packs/vfx/", description: "Particle systems, hits, impacts, bursts, and ambient FX." },
  { id: "3d-vfx", label: "3D VFX", query: "3d vfx spell mesh trail ribbon", category: "3d-vfx", prefix: "asset-packs/vfx/3d/", description: "Mesh-based spell effects, ribbons, and volumetric FX." },
  { id: "spells", label: "Spells", query: "spell magic cast projectile aura slash aoe", category: "spell", prefix: "asset-packs/effects/spells/", description: "Spell kits, cast effects, aura loops, and magic payloads." },
  { id: "slash", label: "Slash", query: "slash swipe arc trail", category: "slash", prefix: "asset-packs/effects/slash/", description: "Slash arcs, swipe trails, and melee attack effects." },
  { id: "projectiles", label: "Projectiles", query: "projectile missile arrow bolt orb", category: "projectile", prefix: "asset-packs/effects/projectiles/", description: "Projectile models, trails, and impact-ready payloads." },
  { id: "aoe", label: "AOE", query: "aoe area ring burst pulse", category: "aoe", prefix: "asset-packs/effects/aoe/", description: "Area rings, pulse bursts, zones, and ground telegraphs." },
  { id: "aura", label: "Aura", query: "aura loop buff shield glow", category: "aura", prefix: "asset-packs/effects/aura/", description: "Aura loops, shields, buff halos, and persistent surrounds." },
  { id: "animations", label: "Animations", query: "animation idle run attack cast", category: "animation", prefix: "asset-packs/animations/", description: "Animation clips, rig actions, and motion sets." },
];

export function navigateTo(route: ForgeRoute): void {
  window.dispatchEvent(new CustomEvent<ForgeRoute>(NAV_EVENT, { detail: route }));
}

export function onNavigateRequest(handler: (route: ForgeRoute) => void): () => void {
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<ForgeRoute>;
    if (customEvent.detail) handler(customEvent.detail);
  };
  window.addEventListener(NAV_EVENT, listener);
  return () => window.removeEventListener(NAV_EVENT, listener);
}

export function setPreviewTarget(url: string): void {
  localStorage.setItem(PREVIEW_TARGET_KEY, url);
}

export function getPreviewTarget(): string | null {
  return localStorage.getItem(PREVIEW_TARGET_KEY);
}

export function clearPreviewTarget(): void {
  localStorage.removeItem(PREVIEW_TARGET_KEY);
}

/** Open a URL in the Preview tab (dev server, build output, or remote staging). */
export function openPreviewUrl(url: string): void {
  setPreviewTarget(url);
  navigateTo("/preview");
  window.grudge?.preview?.open?.(url).catch(() => {
    /* main process may not be ready in unit tests */
  });
}

export function setRequestTarget(path: string): void {
  localStorage.setItem(REQUEST_TARGET_KEY, path);
}

export function getRequestTarget(): string | null {
  return localStorage.getItem(REQUEST_TARGET_KEY);
}

export function clearRequestTarget(): void {
  localStorage.removeItem(REQUEST_TARGET_KEY);
}

export function listRecentUploads(): RecentUploadRecord[] {
  try {
    const raw = localStorage.getItem(RECENT_UPLOADS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function rememberUpload(record: RecentUploadRecord): RecentUploadRecord[] {
  const deduped = listRecentUploads().filter((entry) => entry.objectPath !== record.objectPath);
  const next = [record, ...deduped].slice(0, RECENT_UPLOAD_LIMIT);
  localStorage.setItem(RECENT_UPLOADS_KEY, JSON.stringify(next));
  return next;
}