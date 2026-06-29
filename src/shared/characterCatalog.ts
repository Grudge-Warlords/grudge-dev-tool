/**
 * Grudge Studio — Character Prefabs
 *
 * 24 fully defined starting characters: 6 races × 4 classes.
 * Each prefab specifies the model, starting equipment meshes, animations,
 * base stats, and skill tree entry points.
 *
 * Races: Human (WK_), Barbarian (BRB_), Elf (ELF_), Dwarf (DWF_), Orc (ORC_), Undead (UD_)
 * Classes: Warrior, Mage, Ranger, Worge
 *
 * Equipment meshes reference the customizable FBX child mesh naming convention:
 *   {PREFIX}Units_Body_A, {PREFIX}Units_sword_A, etc.
 *
 * Bone containers: R_hand_container, L_hand_container, L_shield_container
 */

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type RaceId = "human" | "barbarian" | "elf" | "dwarf" | "orc" | "undead";
export type ClassId = "warrior" | "mage" | "ranger" | "worge";
export type FactionId = "crusade" | "fabled" | "legion";

export interface EquipmentSlots {
  body: string;        // e.g. "A" for Units_Body_A
  arms: string;
  legs: string;
  head: string | null; // null = no helmet at start
  shoulders: string | null;
  rightHand: string | null;  // weapon slot
  rightHandType: string | null; // "sword", "axe", "hammer", etc.
  leftHand: string | null;  // bow, staff
  leftHandType: string | null;
  shield: string | null;
  utility: string[];   // ["bag", "quiver"] etc.
}

export interface SkillTreeEntry {
  id: string;
  name: string;
  icon: string;
  description: string;
  tier: number;        // 1-4
  maxRank: number;
  statBonus?: Record<string, number>;
}

export interface CharacterPrefab {
  id: string;          // e.g. "human_warrior"
  race: RaceId;
  classId: ClassId;
  faction: FactionId;
  name: string;        // Display name e.g. "Human Warrior"
  prefix: string;      // FBX child mesh prefix: "WK_", "BRB_", etc.
  modelPath: string;   // Path to FBX/GLB model
  /** CDN manifest key for the animated GLB (if available) */
  cdnModelKey: string | null;
  /** Starting equipment mesh visibility */
  equipment: EquipmentSlots;
  /** Animation pack to use */
  animationPack: string;
  /** Base attribute allocation (8 attrs, totals 20 for starting) */
  baseStats: {
    STR: number; DEX: number; INT: number; VIT: number;
    WIS: number; LCK: number; CHA: number; END: number;
  };
  /** Starting skill tree (first 3 skills per class) */
  skills: SkillTreeEntry[];
  /** Icon URL on GitHub CDN */
  iconUrl: string;
  /** Class color for UI */
  classColor: string;
  /** Lore snippet */
  lore: string;
}

// ═══════════════════════════════════════════════════════════════════
// RACE CONFIGS
// ═══════════════════════════════════════════════════════════════════

const RACE_META: Record<RaceId, { prefix: string; faction: FactionId; modelDir: string }> = {
  human:     { prefix: "WK_",  faction: "crusade", modelDir: "WesternKingdoms" },
  barbarian: { prefix: "BRB_", faction: "crusade", modelDir: "Barbarians" },
  elf:       { prefix: "ELF_", faction: "fabled",  modelDir: "Elves" },
  dwarf:     { prefix: "DWF_", faction: "fabled",  modelDir: "Dwarves" },
  orc:       { prefix: "ORC_", faction: "legion",  modelDir: "Orcs" },
  undead:    { prefix: "UD_",  faction: "legion",  modelDir: "Undead" },
};

const ICONS_BASE = "https://molochdagod.github.io/ObjectStore/icons";

// ═══════════════════════════════════════════════════════════════════
// CLASS DEFINITIONS (shared across races)
// ═══════════════════════════════════════════════════════════════════

const CLASS_CONFIGS: Record<ClassId, {
  animPack: string;
  equipment: Omit<EquipmentSlots, "body" | "arms" | "legs">;
  baseStats: CharacterPrefab["baseStats"];
  color: string;
  skills: SkillTreeEntry[];
}> = {
  warrior: {
    animPack: "1h_sword_shield",
    equipment: {
      head: "A",
      shoulders: null,
      rightHand: "A", rightHandType: "sword",
      leftHand: null, leftHandType: null,
      shield: "A",
      utility: [],
    },
    baseStats: { STR: 5, DEX: 2, INT: 0, VIT: 4, WIS: 0, LCK: 1, CHA: 1, END: 7 },
    color: "#ef4444",
    skills: [
      { id: "shield_wall", name: "Shield Wall", icon: "🛡️", description: "Block all frontal damage for 3s.", tier: 1, maxRank: 5, statBonus: { blockChance: 10 } },
      { id: "cleave", name: "Cleave", icon: "⚔️", description: "Strike all enemies in a cone.", tier: 1, maxRank: 5, statBonus: { meleeAttack: 8 } },
      { id: "war_cry", name: "War Cry", icon: "📯", description: "Boost nearby allies' damage 15%.", tier: 1, maxRank: 3, statBonus: { companionPower: 5 } },
      { id: "charge", name: "Charge", icon: "💨", description: "Rush to target, stunning 1.5s.", tier: 2, maxRank: 5, statBonus: { moveSpeed: 5 } },
      { id: "berserker_rage", name: "Berserker Rage", icon: "🔥", description: "+30% damage, -20% defense for 8s.", tier: 2, maxRank: 3 },
      { id: "last_stand", name: "Last Stand", icon: "💀", description: "Cannot die for 5s when HP drops below 10%.", tier: 3, maxRank: 1 },
    ],
  },
  mage: {
    animPack: "magic",
    equipment: {
      head: null,
      shoulders: null,
      rightHand: null, rightHandType: null,
      leftHand: "A", leftHandType: "staff",
      shield: null,
      utility: [],
    },
    baseStats: { STR: 0, DEX: 1, INT: 7, VIT: 2, WIS: 5, LCK: 2, CHA: 1, END: 2 },
    color: "#8b5cf6",
    skills: [
      { id: "fireball", name: "Fireball", icon: "🔥", description: "Hurl a ball of fire. AoE on impact.", tier: 1, maxRank: 5, statBonus: { spellPower: 10 } },
      { id: "frost_bolt", name: "Frost Bolt", icon: "❄️", description: "Slow target 40% for 4s.", tier: 1, maxRank: 5, statBonus: { spellPower: 6 } },
      { id: "mana_shield", name: "Mana Shield", icon: "🔮", description: "Absorb damage using mana pool.", tier: 1, maxRank: 3, statBonus: { maxMana: 20 } },
      { id: "chain_lightning", name: "Chain Lightning", icon: "⚡", description: "Lightning jumps to 3 nearby enemies.", tier: 2, maxRank: 5, statBonus: { spellPower: 12 } },
      { id: "teleport", name: "Teleport", icon: "✨", description: "Blink to target location.", tier: 2, maxRank: 3 },
      { id: "meteor_storm", name: "Meteor Storm", icon: "☄️", description: "Rain meteors on large area.", tier: 3, maxRank: 1 },
    ],
  },
  ranger: {
    animPack: "longbow",
    equipment: {
      head: null,
      shoulders: null,
      rightHand: null, rightHandType: null,
      leftHand: null, leftHandType: "bow",
      shield: null,
      utility: ["quiver"],
    },
    baseStats: { STR: 1, DEX: 7, INT: 0, VIT: 2, WIS: 1, LCK: 4, CHA: 1, END: 4 },
    color: "#22c55e",
    skills: [
      { id: "aimed_shot", name: "Aimed Shot", icon: "🎯", description: "Charged shot for 250% damage.", tier: 1, maxRank: 5, statBonus: { rangedAttack: 10 } },
      { id: "poison_arrow", name: "Poison Arrow", icon: "☠️", description: "DoT: 3 dmg/s for 6s.", tier: 1, maxRank: 5, statBonus: { rangedAttack: 6 } },
      { id: "evasion", name: "Evasion", icon: "💨", description: "+30% dodge for 6s.", tier: 1, maxRank: 3, statBonus: { dodgeChance: 8 } },
      { id: "rain_of_arrows", name: "Rain of Arrows", icon: "🏹", description: "AoE arrow volley on ground target.", tier: 2, maxRank: 5, statBonus: { rangedAttack: 12 } },
      { id: "shadow_step", name: "Shadow Step", icon: "👤", description: "Stealth + reposition.", tier: 2, maxRank: 3 },
      { id: "eagle_eye", name: "Eagle Eye", icon: "🦅", description: "+50% range, +25% crit for 10s.", tier: 3, maxRank: 1 },
    ],
  },
  worge: {
    animPack: "2h_melee",
    equipment: {
      head: null,
      shoulders: null,
      rightHand: "A", rightHandType: "axe",
      leftHand: null, leftHandType: null,
      shield: null,
      utility: [],
    },
    baseStats: { STR: 4, DEX: 3, INT: 1, VIT: 3, WIS: 1, LCK: 2, CHA: 2, END: 4 },
    color: "#f97316",
    skills: [
      { id: "wolf_form", name: "Wolf Form", icon: "🐺", description: "Transform: +40% speed, +20% melee.", tier: 1, maxRank: 5, statBonus: { moveSpeed: 8 } },
      { id: "feral_charge", name: "Feral Charge", icon: "🐻", description: "Leap to target, stun 1s.", tier: 1, maxRank: 5, statBonus: { meleeAttack: 8 } },
      { id: "primal_roar", name: "Primal Roar", icon: "🦁", description: "Fear nearby enemies 3s.", tier: 1, maxRank: 3, statBonus: { companionPower: 8 } },
      { id: "bear_form", name: "Bear Form", icon: "🐻", description: "Transform: +50% HP, +30% defense.", tier: 2, maxRank: 5, statBonus: { maxHP: 15 } },
      { id: "pack_howl", name: "Pack Howl", icon: "🌙", description: "Buff all allies: +15% damage.", tier: 2, maxRank: 3 },
      { id: "raptor_form", name: "Raptor Form", icon: "🦅", description: "Fly form: +60% speed, ranged attacks.", tier: 3, maxRank: 1 },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════
// GENERATE ALL 24 PREFABS
// ═══════════════════════════════════════════════════════════════════

function buildPrefab(race: RaceId, classId: ClassId): CharacterPrefab {
  const raceMeta = RACE_META[race];
  const classCfg = CLASS_CONFIGS[classId];
  const raceNames: Record<RaceId, string> = {
    human: "Human", barbarian: "Barbarian", elf: "Elf",
    dwarf: "Dwarf", orc: "Orc", undead: "Undead",
  };
  const classNames: Record<ClassId, string> = {
    warrior: "Warrior", mage: "Mage", ranger: "Ranger", worge: "Worge",
  };

  // CDN model mapping — toon-shooter characters as placeholders until race-specific GLBs are uploaded
  const cdnModelMap: Record<FactionId, string> = {
    crusade: "char_soldier",
    fabled: "char_hazmat",
    legion: "char_enemy",
  };

  // Starting armor variant per class
  const armorVariant: Record<ClassId, { body: string; arms: string; legs: string }> = {
    warrior: { body: "A", arms: "A", legs: "A" },  // Heavy plate
    mage:    { body: "C", arms: "C", legs: "B" },  // Light robes
    ranger:  { body: "B", arms: "B", legs: "B" },  // Medium leather
    worge:   { body: "D", arms: "A", legs: "C" },  // Primal/light
  };

  const armor = armorVariant[classId];
  const classIcon: Record<ClassId, string> = {
    warrior: "abilities/ability_shield_bash",
    mage: "abilities/ability_arcane_bolt",
    ranger: "abilities/ability_arrow_storm",
    worge: "abilities/ability_bear_form",
  };

  const loreMap: Record<string, string> = {
    human_warrior: "A disciplined soldier of the Western Kingdoms, trained in sword and shield from birth.",
    human_mage: "A scholar of Odin's wisdom, channeling arcane forces through ancient staves.",
    human_ranger: "A keen-eyed hunter from the Foresight Outposts, master of the longbow.",
    human_worge: "A shapeshifter blessed by Odin's wolves, fighting with primal fury.",
    barbarian_warrior: "A berserker from the frozen north, wielding blade and rage in equal measure.",
    barbarian_mage: "A storm caller drawing power from the Cosmic Waterfall.",
    barbarian_ranger: "A wind rider who hunts across the mountain peaks.",
    barbarian_worge: "Born of the wild, this fangborn fights alongside wolf and bear spirits.",
    elf_warrior: "A blade dancer whose elven grace makes every strike a lethal art.",
    elf_mage: "A storm weaver drawing magic from the roots of Yggdrasil.",
    elf_ranger: "A swiftbow who never misses, guided by starlight and ancient instinct.",
    elf_worge: "A wildheart who communes with forest beasts and fights as nature's champion.",
    dwarf_warrior: "An ironshield whose dwarven fortitude can withstand any blow.",
    dwarf_mage: "A forgekeeper who commands fire and rune magic from the deep.",
    dwarf_ranger: "A tunnelwatcher whose crossbow bolts find their mark in total darkness.",
    dwarf_worge: "An earthshaker who takes the form of mountain beasts.",
    orc_warrior: "An ironjaw whose war stomp shakes the ground beneath enemy feet.",
    orc_mage: "A hexmaster wielding voodoo and spirit magic.",
    orc_ranger: "A deadeye hunter whose poison arrows bring slow, certain death.",
    orc_worge: "A bloodfang who shifts into dire wolf form, howling for the pack.",
    undead_warrior: "Lord of death, wielding unholy power and an unbreakable shield.",
    undead_mage: "A necromancer who raises the fallen to fight again.",
    undead_ranger: "A shade whisper who moves unseen, firing spectral arrows.",
    undead_worge: "The Ghoulfather, whose plague aura corrupts all nearby life.",
  };

  return {
    id: `${race}_${classId}`,
    race,
    classId,
    faction: raceMeta.faction,
    name: `${raceNames[race]} ${classNames[classId]}`,
    prefix: raceMeta.prefix,
    modelPath: `factioncharacters/${raceMeta.modelDir}/models/${raceMeta.prefix}Characters_customizable.FBX`,
    cdnModelKey: cdnModelMap[raceMeta.faction],
    equipment: {
      body: armor.body,
      arms: armor.arms,
      legs: armor.legs,
      head: classCfg.equipment.head,
      shoulders: classCfg.equipment.shoulders,
      rightHand: classCfg.equipment.rightHand,
      rightHandType: classCfg.equipment.rightHandType,
      leftHand: classCfg.equipment.leftHand,
      leftHandType: classCfg.equipment.leftHandType,
      shield: classCfg.equipment.shield,
      utility: classCfg.equipment.utility,
    },
    animationPack: classCfg.animPack,
    baseStats: { ...classCfg.baseStats },
    skills: classCfg.skills.map(s => ({ ...s })),
    iconUrl: `${ICONS_BASE}/${classIcon[classId]}.png`,
    classColor: classCfg.color,
    lore: loreMap[`${race}_${classId}`] || `A ${raceNames[race]} ${classNames[classId]} of the ${raceMeta.faction} faction.`,
  };
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

const ALL_RACES: RaceId[] = ["human", "barbarian", "elf", "dwarf", "orc", "undead"];
const ALL_CLASSES: ClassId[] = ["warrior", "mage", "ranger", "worge"];

/** All 24 character prefabs */
export const CHARACTER_PREFABS: CharacterPrefab[] = ALL_RACES.flatMap(race =>
  ALL_CLASSES.map(cls => buildPrefab(race, cls))
);

/** Lookup by ID */
export function getPrefab(id: string): CharacterPrefab | undefined {
  return CHARACTER_PREFABS.find(p => p.id === id);
}

/** Get all prefabs for a race */
export function getPrefabsByRace(race: RaceId): CharacterPrefab[] {
  return CHARACTER_PREFABS.filter(p => p.race === race);
}

/** Get all prefabs for a class */
export function getPrefabsByClass(classId: ClassId): CharacterPrefab[] {
  return CHARACTER_PREFABS.filter(p => p.classId === classId);
}

/** Get all prefabs for a faction */
export function getPrefabsByFaction(faction: FactionId): CharacterPrefab[] {
  return CHARACTER_PREFABS.filter(p => p.faction === faction);
}

/** Get the equipment mesh names for a prefab (with prefix applied) */
export function getEquipmentMeshNames(prefab: CharacterPrefab): string[] {
  const p = prefab.prefix;
  const e = prefab.equipment;
  const meshes: string[] = [];

  meshes.push(`${p}Units_Body_${e.body}`);
  meshes.push(`${p}Units_Arms_${e.arms}`);
  meshes.push(`${p}Units_Legs_${e.legs}`);
  if (e.head) meshes.push(`${p}Units_head_${e.head}`);
  if (e.shoulders) meshes.push(`${p}Units_shoulderpads_${e.shoulders}`);
  if (e.rightHand && e.rightHandType) meshes.push(`${p}Units_${e.rightHandType}_${e.rightHand}`);
  if (e.leftHand && e.leftHandType) {
    if (e.leftHandType === "bow") meshes.push(`${p}Units_Bow`);
    else meshes.push(`${p}Units_${e.leftHandType}_${e.leftHand}`);
  }
  if (e.shield) meshes.push(`${p}Units_shield_${e.shield}`);
  e.utility.forEach(u => meshes.push(`${p}Xtra_${u}`));

  return meshes;
}

/** Summary stats */
export const PREFAB_STATS = {
  total: CHARACTER_PREFABS.length,
  races: ALL_RACES.length,
  classes: ALL_CLASSES.length,
  skillsPerClass: 6,
  totalSkills: ALL_CLASSES.length * 6,
} as const;
