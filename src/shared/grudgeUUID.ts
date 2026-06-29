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
  // Asset-pack content
  Texture: "texr", TextureMaterial: "mati", BlendModel: "mdlb",
  Sprite: "sprt", Audio: "audi", Mesh: "mesh",
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

export function generateGrudgeUUID(
  slotOrType: string,
  tier: number | null,
  itemId: number,
): string {
  const slotCode = getSlotCode(slotOrType);
  const tierCode = tierToCode(tier);
  const idStr = String(itemId).padStart(4, "0");
  return `${slotCode}-${tierCode}-${idStr}-${texasTimestamp()}-${nextCounter()}`;
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
