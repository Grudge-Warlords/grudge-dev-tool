/**
 * Grudge6 EquipmentManager — child-mesh toggle for RTS toon race GLBs.
 * Ported from grudge-builder (Warlords / home-island) for Engine equip testing.
 *
 * Race packs (WK_/BRB_/ELF_/DWF_/ORC_/UD_) share Units_* mesh slots.
 * Catalog once per load; equip() swaps visible armor/weapon variants.
 */
import * as THREE from "three";

interface SlotDef {
  slot: string;
  re: RegExp;
  group: string;
  noVariant?: boolean;
}

const SLOT_DEFS: SlotDef[] = [
  { slot: "body", re: /Units_Body_([A-Z])$/i, group: "armor" },
  { slot: "arms", re: /Units_Arms_([A-Z])$/i, group: "armor" },
  { slot: "legs", re: /Units_Legs_([A-Z])$/i, group: "armor" },
  { slot: "head", re: /Units_head_([A-Z])$/i, group: "armor" },
  { slot: "shoulders", re: /Units_shoulderpads_([A-Z])$/i, group: "armor" },
  { slot: "axe", re: /(?:Units_|weapon_)axe_([A-Z])$/i, group: "weapon_r" },
  { slot: "hammer", re: /(?:Units_|weapon_)hammer_([A-Z])$/i, group: "weapon_r" },
  { slot: "sword", re: /(?:Units_|weapon_)[Ss]word_([A-Z])$/i, group: "weapon_r" },
  { slot: "pick", re: /(?:Units_|weapon_)pick$/i, group: "weapon_r", noVariant: true },
  { slot: "spear", re: /(?:Units_|weapon_)[Ss]pear$/i, group: "weapon_r", noVariant: true },
  { slot: "bow", re: /(?:Units_|weapon_)[Bb]ow$/i, group: "weapon_l", noVariant: true },
  { slot: "staff", re: /(?:Units_|weapon_)staff_([A-Z])$/i, group: "weapon_l" },
  { slot: "shield", re: /(?:Units_|)[Ss]hield_([A-Z])$/i, group: "shield" },
  { slot: "bag", re: /(?:Xtra_|Units_)bag$/i, group: "utility", noVariant: true },
  { slot: "wood", re: /(?:Xtra_|Units_)wood$/i, group: "utility", noVariant: true },
  { slot: "quiver", re: /(?:Xtra_|Units_)quiver$/i, group: "utility", noVariant: true },
];

const WEAPON_SLOTS = new Set(["axe", "hammer", "sword", "pick", "spear", "bow", "staff", "shield"]);
const ARMOR_DEFAULTS: Record<string, string> = {
  body: "A",
  arms: "A",
  legs: "A",
  head: "A",
};

const RACE_PREFIXES = ["WK_", "BRB_", "ELF_", "DWF_", "ORC_", "UD_"];

function stripRacePrefix(name: string, preferred: string): string {
  if (!name) return name;
  if (preferred && name.startsWith(preferred)) return name.slice(preferred.length);
  for (const p of RACE_PREFIXES) {
    if (name.startsWith(p)) return name.slice(p.length);
  }
  const lower = name.toLowerCase();
  for (const p of RACE_PREFIXES) {
    if (lower.startsWith(p.toLowerCase())) return name.slice(p.length);
  }
  return name;
}

function normalizeVariant(raw: string | undefined, noVariant: boolean): string {
  if (noVariant) return "_default";
  if (!raw) return "A";
  const v = String(raw).trim().toUpperCase();
  if (v === "_DEFAULT" || v === "DEFAULT" || v === "") return noVariant ? "_default" : "A";
  const letter = v.replace(/^.*_/, "").replace(/[^A-Z]/g, "");
  return letter || "A";
}

export interface EquipmentLoadout {
  equippedMeshes: Record<string, string>;
  weaponSlots: Record<string, string>;
  armorColor?: string;
}

export class Grudge6EquipmentManager {
  readonly prefix: string;
  slots: Record<string, Record<string, THREE.Object3D>> = {};
  equipped: Record<string, string> = {};
  bones: Record<string, THREE.Object3D | null> = {};
  private _allMeshes: THREE.Object3D[] = [];
  root: THREE.Object3D | null = null;

  constructor(prefix: string) {
    this.prefix = prefix || "WK_";
  }

  catalog(root: THREE.Object3D): Record<string, string[]> {
    this.root = root;
    this.slots = {};
    this._allMeshes = [];
    this.equipped = {};

    this.bones.rightHand = root.getObjectByName("R_hand_container") ?? null;
    this.bones.leftHand = root.getObjectByName("L_hand_container") ?? null;
    this.bones.leftShield = root.getObjectByName("L_shield_container") ?? null;
    this.bones.bag = root.getObjectByName("Bone_bag") ?? null;
    this.bones.wood = root.getObjectByName("Bone_wood") ?? null;
    this.bones.quiver = root.getObjectByName("Quiver_container") ?? null;

    root.traverse((child) => {
      const mesh = child as THREE.Mesh & { isSkinnedMesh?: boolean };
      if (!mesh.isMesh && !mesh.isSkinnedMesh) return;
      if (!mesh.name) return;

      const stripped = stripRacePrefix(mesh.name, this.prefix);

      for (const def of SLOT_DEFS) {
        let match = stripped.match(def.re);
        if (!match) match = mesh.name.match(def.re);
        if (!match) continue;

        const variant = def.noVariant
          ? "_default"
          : normalizeVariant(match[1], false);

        if (!this.slots[def.slot]) this.slots[def.slot] = {};
        if (!this.slots[def.slot][variant]) {
          this.slots[def.slot][variant] = mesh;
        }
        mesh.userData.equipSlot = def.slot;
        mesh.userData.equipVariant = variant;
        mesh.userData.equipGroup = def.group;
        this._allMeshes.push(mesh);
        mesh.visible = false;
        break;
      }
    });

    if (this._allMeshes.length === 0) {
      console.warn(
        `[Grudge6Equip] No equip meshes matched for prefix=${this.prefix}. ` +
          `Is this a grudge6 race GLB with Units_* children?`,
      );
    }

    return this.getSlotSummary();
  }

  equip(slot: string, variant: string, armorColor?: string): boolean {
    const variants = this.slots[slot];
    if (!variants) return false;

    const want = normalizeVariant(variant, false);
    const keys = Object.keys(variants);
    const resolved = variants[want] ? want : keys.includes("A") ? "A" : keys[0];
    if (!resolved) return false;

    for (const [v, mesh] of Object.entries(variants)) {
      const m = mesh as THREE.Mesh;
      if (v === resolved) {
        m.visible = true;
        if (armorColor && armorColor !== "#ffffff" && armorColor !== "#fff") {
          this.tintMesh(m, armorColor);
        }
      } else {
        m.visible = false;
      }
    }
    this.equipped[slot] = resolved;
    return true;
  }

  equipWeapon(slot: string, variant = "_default"): boolean {
    const def = SLOT_DEFS.find((d) => d.slot === slot);
    if (!def) return false;

    for (const mesh of this._allMeshes) {
      if (mesh.userData.equipGroup === def.group) {
        mesh.visible = false;
        delete this.equipped[mesh.userData.equipSlot as string];
      }
    }
    const v = def.noVariant ? "_default" : normalizeVariant(variant, false);
    return this.equip(slot, v);
  }

  unequip(slot: string): void {
    const variants = this.slots[slot];
    if (!variants) return;
    for (const mesh of Object.values(variants)) mesh.visible = false;
    delete this.equipped[slot];
  }

  clearWeapons(): void {
    for (const slot of WEAPON_SLOTS) {
      this.unequip(slot);
    }
  }

  ensureBaseArmorVisible(): void {
    for (const [slot, defVariant] of Object.entries(ARMOR_DEFAULTS)) {
      if (!this.slots[slot]) continue;
      if (this.equipped[slot]) continue;
      this.equip(slot, defVariant);
    }
  }

  applyLoadout(loadout: EquipmentLoadout): void {
    for (const [slot, variant] of Object.entries(loadout.equippedMeshes ?? {})) {
      this.equip(slot, variant, loadout.armorColor);
    }
    // Clear then re-apply weapons so only one weapon_r / weapon_l shows
    this.clearWeapons();
    for (const [slot, variant] of Object.entries(loadout.weaponSlots ?? {})) {
      if (WEAPON_SLOTS.has(slot)) {
        this.equipWeapon(slot, variant);
      }
    }
    this.ensureBaseArmorVisible();
  }

  getSlotSummary(): Record<string, string[]> {
    const summary: Record<string, string[]> = {};
    for (const [slot, variants] of Object.entries(this.slots)) {
      summary[slot] = Object.keys(variants).sort();
    }
    return summary;
  }

  get meshCount(): number {
    return this._allMeshes.length;
  }

  private tintMesh(mesh: THREE.Mesh, color: string): void {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const tint = new THREE.Color(color);
    for (const mat of mats) {
      if (!mat || !(mat as THREE.MeshStandardMaterial).color) continue;
      const std = mat as THREE.MeshStandardMaterial;
      if (!std.userData._grudgeBaseColor) {
        std.userData._grudgeBaseColor = std.color.clone();
      }
      std.color.copy(std.userData._grudgeBaseColor as THREE.Color).multiply(tint);
      std.needsUpdate = true;
    }
  }
}

export function setupGrudge6Equipment(
  racePrefix: string,
  scene: THREE.Object3D,
  loadout: EquipmentLoadout,
): Grudge6EquipmentManager {
  const em = new Grudge6EquipmentManager(racePrefix);
  em.catalog(scene);
  em.applyLoadout({
    equippedMeshes: {
      body: "A",
      arms: "A",
      legs: "A",
      head: "A",
      ...loadout.equippedMeshes,
    },
    weaponSlots: { ...loadout.weaponSlots },
    armorColor: loadout.armorColor,
  });
  return em;
}

/** Map EquipmentSlots-style prefab equipment → loadout for the manager. */
export function prefabEquipmentToLoadout(equipment: {
  body: string;
  arms: string;
  legs: string;
  head: string | null;
  shoulders: string | null;
  rightHand: string | null;
  rightHandType: string | null;
  leftHand: string | null;
  leftHandType: string | null;
  shield: string | null;
  utility: string[];
}): EquipmentLoadout {
  const equippedMeshes: Record<string, string> = {
    body: equipment.body || "A",
    arms: equipment.arms || "A",
    legs: equipment.legs || "A",
  };
  if (equipment.head) equippedMeshes.head = equipment.head;
  if (equipment.shoulders) equippedMeshes.shoulders = equipment.shoulders;
  for (const u of equipment.utility ?? []) {
    equippedMeshes[u] = "_default";
  }

  const weaponSlots: Record<string, string> = {};
  if (equipment.rightHandType) {
    weaponSlots[equipment.rightHandType] = equipment.rightHand || "A";
  }
  if (equipment.leftHandType) {
    const lt = equipment.leftHandType;
    weaponSlots[lt] = lt === "bow" || lt === "spear" || lt === "pick"
      ? "_default"
      : (equipment.leftHand || "A");
  }
  if (equipment.shield) {
    weaponSlots.shield = equipment.shield;
  }

  return { equippedMeshes, weaponSlots };
}
