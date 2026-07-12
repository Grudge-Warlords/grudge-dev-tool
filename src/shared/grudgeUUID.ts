/**
 * Grudge UUID System (dev-tool local mirror)
 * Format: SLOT-TIER-ITEMID-TIMESTAMP-COUNTER
 *   SLOT      4 chars  — slot/type code
 *   TIER      2 chars  — t0..t8 or 'oo'
 *   ITEMID    4 digits — 0001..9999
 *   TIMESTAMP 12 digit — HHMMMMDDYYYY (Texas time, Central)
 *   COUNTER   6 alphanum — base-36 (000001..zzzzzz)
 *
 * This file is intentionally a copy of GrudgeBuilder/shared/grudgeUUID.ts so
 * the dev-tool stays self-contained for packaging. Any change here MUST be
 * mirrored to GrudgeBuilder.
 */

export const SLOT_CODES: Record<string, string> = {
  // Armor
  Helm: "helm", Head: "head", Shoulder: "shou", Chest: "ches",
  Hands: "hand", Gloves: "glov", Legs: "legs", Feet: "feet",
  Ring: "ring", Necklace: "neck", Relic: "reli", Offhand: "offh",
  Shield: "shld",
  // Weapons
  MainHand: "main", TwoHand: "twoh", Weapon: "weap",
  Sword: "swrd", Axe: "axee", Mace: "mace", Dagger: "dagr",
  Staff: "staf", Wand: "wand", Bow: "boww", Crossbow: "xbow",
  Polearm: "pole", Hammer: "hamr", Spear: "sper",
  // Resources
  Ore: "orex", Mine: "mine", Wood: "wood", Log: "logs",
  Herb: "herb", Fiber: "fibr", Hide: "hide", Leather: "lthr",
  Cloth: "clth", Metal: "metl", Gem: "gemx", Stone: "ston",
  Crystal: "crys", Essence: "essn",
  // Consumables
  Potion: "potn", Food: "food", Scroll: "scrl", Elixir: "elix",
  // Crafting
  Material: "matl", Component: "comp", Ingredient: "ingr",
  // Misc
  Item: "item", Quest: "qust", Key: "keyy", Token: "tokn",
  Currency: "curr", Loot: "loot", Treasure: "trea", Artifact: "artf",
  // Asset-pack / CDN content (stable asset identity)
  Texture: "texr", TextureMaterial: "mati", BlendModel: "mdlb",
  Sprite: "sprt", Audio: "audi", Mesh: "mesh",
  /** Particle / spell / trail VFX packs */
  Vfx: "vfxa",
  /** UI icons / ability icons */
  Icon: "icon",
  /** Animation clips / Mixamo packs */
  Anim: "anim",
  /** Map / environment GLBs */
  Map: "mapa",
  /** Character race kits / skinned units */
  Character: "char",
  /** Weapon meshes */
  WeaponMesh: "wepm",
  // Fallbacks
  Unknown: "unkn", Other: "othr",
};

export const CODE_TO_SLOT: Record<string, string> = Object.fromEntries(
  Object.entries(SLOT_CODES).map(([k, v]) => [v, k]),
);

export const TIER_CODES = [
  "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "oo",
] as const;
export type TierCode = (typeof TIER_CODES)[number];

const ALPHANUM = "0123456789abcdefghijklmnopqrstuvwxyz";

let counterState = 1;

export function setCounterState(v: number): void { counterState = v; }
export function getCounterState(): number { return counterState; }

function toAlphanum(num: number, length = 6): string {
  let result = "";
  let n = num;
  do {
    result = ALPHANUM[n % 36] + result;
    n = Math.floor(n / 36);
  } while (n > 0);
  return result.padStart(length, "0");
}

function nextCounter(): string {
  const out = toAlphanum(counterState, 6);
  counterState += 1;
  return out;
}

function texasTimestamp(): string {
  const now = new Date();
  const tx = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Chicago" }),
  );
  const hh = String(tx.getHours()).padStart(2, "0");
  const mm = String(tx.getMinutes()).padStart(2, "0");
  const mo = String(tx.getMonth() + 1).padStart(2, "0");
  const dd = String(tx.getDate()).padStart(2, "0");
  const yy = String(tx.getFullYear());
  return `${hh}${mm}${mo}${dd}${yy}`;
}

export function tierToCode(tier: number | null | undefined): TierCode {
  if (tier === null || tier === undefined) return "oo";
  if (tier >= 0 && tier <= 8) return `t${tier}` as TierCode;
  return "oo";
}

export function getSlotCode(slot: string | null | undefined): string {
  if (!slot) return "item";
  if (SLOT_CODES[slot]) return SLOT_CODES[slot];
  const norm = slot.charAt(0).toUpperCase() + slot.slice(1).toLowerCase();
  if (SLOT_CODES[norm]) return SLOT_CODES[norm];
  for (const [k, v] of Object.entries(SLOT_CODES)) {
    const lk = k.toLowerCase();
    const ls = slot.toLowerCase();
    if (lk.includes(ls) || ls.includes(lk)) return v;
  }
  return slot.toLowerCase().slice(0, 4).padEnd(4, "x") || "unkn";
}

export interface GrudgeUUIDComponents {
  slot: string;
  tier: TierCode;
  itemId: string;
  timestamp: string;
  counter: string;
}

/**
 * Time-based UUID for **inventory / drop / crafted instances** (unique each mint).
 * Not stable across re-index — use {@link generateStableAssetUUID} for CDN assets.
 */
export function generateGrudgeUUID(
  slotOrType: string,
  tier: number | null,
  itemId: number,
): string {
  const slotCode = getSlotCode(slotOrType);
  const tierCode = tierToCode(tier);
  const idStr = String(Math.max(1, Math.min(9999, Math.floor(itemId)))).padStart(4, "0");
  return `${slotCode}-${tierCode}-${idStr}-${texasTimestamp()}-${nextCounter()}`;
}

/** Normalize R2 / CDN object keys for stable hashing. */
export function normalizeAssetPath(raw: string): string {
  let p = (raw || "").trim().replace(/\\/g, "/");
  p = p.replace(/^https?:\/\/assets\.grudge-studio\.com\//i, "");
  p = p.replace(/^https?:\/\/[^/]+\/objects\//i, "");
  p = p.replace(/^\/+/, "");
  p = p.replace(/^objects\//, "");
  p = p.split("?")[0].split("#")[0];
  // collapse accidental double slashes
  p = p.replace(/\/+/g, "/");
  return p;
}

/**
 * Infer asset family / slot label from object path + extension.
 * Used so race GLBs, textures, VFX, icons get meaningful SLOT codes.
 */
export function inferAssetSlot(objectPath: string): string {
  const p = normalizeAssetPath(objectPath).toLowerCase();
  const ext = p.includes(".") ? p.slice(p.lastIndexOf(".")) : "";

  if (p.includes("/vfx/") || p.includes("vfx-") || p.includes("/effects/") || p.includes("/fx/")) {
    return "Vfx";
  }
  if (
    p.includes("/icon") ||
    p.includes("/icons/") ||
    (p.includes("/ui/") && (ext === ".png" || ext === ".webp" || ext === ".svg"))
  ) {
    return "Icon";
  }
  if (p.includes("/anim") || p.includes("animation") || p.includes("/loco-") || p.includes("mixamo")) {
    return "Anim";
  }
  if (p.includes("/map") || p.includes("map-") || p.includes("/terrain/") || p.includes("/environment/")) {
    return "Map";
  }
  if (
    p.includes("/races/") ||
    p.includes("characters/") ||
    p.includes("/char-") ||
    p.includes("grudge6/races") ||
    p.includes("toon-rts-characters")
  ) {
    return "Character";
  }
  if (p.includes("/weapon") || p.includes("/guns/") || p.includes("race-weapon")) {
    return "WeaponMesh";
  }
  if ([".glb", ".gltf", ".fbx", ".obj", ".blend", ".dae", ".stl", ".ply", ".3mf"].includes(ext)) {
    return "Mesh";
  }
  if ([".png", ".jpg", ".jpeg", ".webp", ".tga", ".bmp", ".gif"].includes(ext)) {
    if (p.includes("/texture") || p.includes("textures/") || p.includes("_albedo") || p.includes("_normal")) {
      return "Texture";
    }
    return "Sprite";
  }
  if ([".ogg", ".wav", ".mp3", ".flac"].includes(ext)) return "Audio";
  return "Item";
}

/**
 * **Stable asset UUID** — same R2/CDN path always yields the same ID across
 * Studio, Forge, Warlords, and inventory tooling.
 *
 * Format still matches Grudge UUID: `SLOT-TIER-ITEMID-STAMP-COUNTER`
 * where STAMP (12) + COUNTER (6) + ITEMID are derived from SHA-256 of the path
 * (not wall-clock time). Re-running backfill never renames an existing asset.
 *
 * Namespace: `grudge-asset-v1:` so future format bumps can migrate intentionally.
 */
export function generateStableAssetUUID(
  objectPath: string,
  slotOrType?: string,
): string {
  // Lazy require-free: use Web Crypto when available is awkward in shared;
  // callers in Node should prefer generateStableAssetUUIDFromHash with sha256.
  // For browser-only we fall back to a simple FNV-like mix (main process always
  // passes a real hash via assetRegistry).
  const path = normalizeAssetPath(objectPath);
  const slot = getSlotCode(slotOrType || inferAssetSlot(path));
  const seed = `grudge-asset-v1:${path}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Expand to 32 hex-ish digits via multi-round mix
  const parts: string[] = [];
  let x = h >>> 0;
  for (let i = 0; i < 8; i++) {
    x = Math.imul(x ^ (x >>> 16), 2246822507) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
    parts.push((x >>> 0).toString(16).padStart(8, "0"));
  }
  const hex = parts.join("");
  return formatStableFromHex(slot, hex);
}

/** Node/main: preferred stable mint from real SHA-256 hex of path (or file bytes). */
export function generateStableAssetUUIDFromHash(
  objectPath: string,
  sha256Hex: string,
  slotOrType?: string,
): string {
  const path = normalizeAssetPath(objectPath);
  const slot = getSlotCode(slotOrType || inferAssetSlot(path));
  // Prefer content hash when present; mix with path so renamed files get new IDs
  // while identical path+content stays stable.
  const material = (sha256Hex || "").toLowerCase().replace(/[^0-9a-f]/g, "");
  const hex =
    material.length >= 32
      ? material
      : // fall back to path-only deterministic expansion
        (() => {
          const seed = `grudge-asset-v1:${path}`;
          let h = 2166136261;
          for (let i = 0; i < seed.length; i++) {
            h ^= seed.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          const out: string[] = [];
          let x = h >>> 0;
          for (let i = 0; i < 8; i++) {
            x = Math.imul(x ^ (x >>> 16), 2246822507) >>> 0;
            x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
            out.push((x >>> 0).toString(16).padStart(8, "0"));
          }
          return out.join("");
        })();
  return formatStableFromHex(slot, hex);
}

function formatStableFromHex(slotCode: string, hex: string): string {
  const h = (hex + "0".repeat(40)).slice(0, 40);
  const itemId = String((parseInt(h.slice(0, 4), 16) % 9999) + 1).padStart(4, "0");
  // 12-char stamp + 6-char counter from hash (hex ⊆ base36 alphabet)
  const stamp = h.slice(4, 16);
  const counter = h.slice(16, 22);
  return `${slotCode}-oo-${itemId}-${stamp}-${counter}`;
}

export function parseGrudgeUUID(uuid: string): GrudgeUUIDComponents | null {
  const parts = uuid.split("-");
  if (parts.length !== 5) return null;
  const [slot, tier, itemId, timestamp, counter] = parts;
  if (
    slot.length !== 4 ||
    tier.length !== 2 ||
    itemId.length !== 4 ||
    timestamp.length !== 12 ||
    counter.length < 6
  ) return null;
  return { slot, tier: tier as TierCode, itemId, timestamp, counter };
}

export function isValidGrudgeUUID(uuid: string): boolean {
  return parseGrudgeUUID(uuid) !== null;
}

export function describeGrudgeUUID(uuid: string): string | null {
  const c = parseGrudgeUUID(uuid);
  if (!c) return null;
  const slotName = CODE_TO_SLOT[c.slot] || c.slot;
  const tierNum = c.tier === "oo" ? null : parseInt(c.tier.slice(1), 10);
  const tierStr = tierNum === null ? "No Tier" : `Tier ${tierNum}`;
  const t = c.timestamp;
  const dateStr = `${t.slice(4, 6)}/${t.slice(6, 8)}/${t.slice(8, 12)} ${t.slice(0, 2)}:${t.slice(2, 4)} CST`;
  return `${slotName} ${tierStr} (Item #${c.itemId}) — Created ${dateStr} [${c.counter}]`;
}
