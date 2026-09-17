import { getFleetUrls } from '@grudge-studio/core';

// src/grudge6.ts
var GRUDGE6_RACE_FBX = {
  human: "models/grudge6/races/WK_Characters.fbx",
  barbarian: "models/grudge6/races/BRB_Characters.fbx",
  dwarf: "models/grudge6/races/DWF_Characters.fbx",
  elf: "models/grudge6/races/ELF_Characters.fbx",
  orc: "models/grudge6/races/ORC_Characters.fbx",
  undead: "models/grudge6/races/UD_Characters.fbx"
};
var GRUDGE6_RACE_ATLAS = {
  human: "textures/grudge6/western-kingdoms/WK_Standard_Units.webp",
  barbarian: "textures/grudge6/barbarians/BRB_StandardUnits_texture.webp",
  dwarf: "textures/grudge6/dwarves/DWF_Standard_Units.webp",
  elf: "textures/grudge6/elves/ELF_HighElves_Texture.webp",
  orc: "textures/grudge6/orcs/ORC_StandardUnits.webp",
  undead: "textures/grudge6/undead/UD_Standard_Units.webp"
};
function grudge6RaceUrl(raceId) {
  const rel = GRUDGE6_RACE_FBX[raceId] ?? GRUDGE6_RACE_FBX.human;
  return `${getFleetUrls().assets}/${rel}`;
}
function grudge6AtlasUrl(raceId) {
  const rel = GRUDGE6_RACE_ATLAS[raceId] ?? GRUDGE6_RACE_ATLAS.human;
  return `${getFleetUrls().assets}/${rel}`;
}
function weaponToAnimPack(weapon) {
  const w = weapon.toLowerCase();
  if (w.includes("crossbow") || w.includes("xbow")) return "crossbow";
  if (w.includes("bow")) return "longbow";
  if (w.includes("rifle")) return "rifle";
  if (w.includes("pistol") || w.includes("gun")) return "pistol";
  if (w.includes("magic") || w.includes("staff")) return "magic";
  if (w.includes("mace") || w.includes("hammer") || w.includes("club")) return "mace_1h";
  if (w.includes("katana") || w.includes("samurai")) return "samurai";
  if (w.includes("greatsword") || w.includes("2h")) return "2h_melee";
  if (w.includes("axe") || w.includes("hatchet")) return "axe_1h";
  if (w.includes("unarmed") || w.includes("fist")) return "unarmed";
  return "sword_shield";
}
var CDN = () => getFleetUrls().assets;
var STYLIZED_NATURE = {
  vegetation: "models/nature/stylized/biome/nature_vegetation.glb",
  trees: "models/nature/stylized/biome/realistic_trees.glb",
  tropical: "models/nature/stylized/biome/tropical_plants.glb",
  volcanic: "models/nature/stylized/biome/volcanicnature.glb",
  snow: "models/nature/stylized/biome/snowbiomes.glb",
  rocks: "models/nature/stylized/rocks/stylised_rocks.glb",
  volcanicRocks: "models/nature/stylized/rocks/volcanic_rocks.glb",
  cliff: "models/nature/stylized/cliffs/stylized_cliff_face.glb",
  flowers: "models/nature/stylized/harvest/flowers_pack.glb",
  foliage: "models/nature/stylized/harvest/foliage_pack.glb",
  minerals: "models/nature/stylized/harvest/minerals_pack.glb",
  oreNodes: "models/nature/stylized/harvest/ore_nodes.glb"
};
function natureUrl(key) {
  return `${CDN()}/${STYLIZED_NATURE[key]}`;
}
var STYLIZED_VARIANTS = {
  rocks: ["Plain_Rock1", "Plain_Rock2", "Plain_Rock3", "Plain_Rock5", "Plain_Rock8"],
  oreNodes: ["Iron_Node", "Copper_Node", "Coal_Node", "Tin_Node"]
};
var BAKED_ANIM_ARENA = "https://grudge-arena.grudge-studio.com/api/assets/anims/baked";
function bakedAnimUrl(rel, sameOrigin = true) {
  const clean = rel.replace(/^\/+/, "").replace(/\.json$/i, "");
  const encoded = clean.split("/").map((s) => encodeURIComponent(s)).join("/");
  if (sameOrigin) return `/anims/baked/${encoded}.json`;
  return `${getFleetUrls().assets}/anims/baked/${encoded}.json`;
}
function bakedAnimUrlCandidates(rel) {
  const clean = rel.replace(/^\/+/, "").replace(/\.json$/i, "");
  const encoded = clean.split("/").map((s) => encodeURIComponent(s)).join("/");
  const assets = getFleetUrls().assets.replace(/\/$/, "");
  return [
    `/anims/baked/${encoded}.json`,
    `${assets}/anims/baked/${encoded}.json`,
    `${BAKED_ANIM_ARENA}/${encoded}.json`
  ];
}
function normalizeAnimPackId(id) {
  if (!id) return "sword_shield";
  const raw = String(id).trim().toLowerCase().replace(/\s+/g, "_");
  const aliases = {
    "1h_sword_shield": "sword_shield",
    "1h-sword-shield": "sword_shield",
    swordandshield: "sword_shield",
    bow: "longbow",
    staff: "magic",
    greatsword: "samurai",
    "2h_melee": "samurai",
    "2h": "samurai",
    katana: "samurai",
    dodge: "dash",
    evade: "dash",
    mobility: "dash",
    one_piece: "opb_clips",
    opb: "opb_clips",
    opb_native: "opb_clips",
    bounty_rush: "opb_clips",
    adio: "pistol",
    gun: "pistol",
    handgun: "pistol",
    gunfight: "pistol",
    xbow: "crossbow",
    cross_bow: "crossbow",
    knockback: "reactions",
    flyback: "reactions",
    getup: "reactions",
    hitstun: "reactions",
    parry: "block",
    defense: "block",
    kaykit: "kaykit_clips",
    mace: "mace_1h",
    "1h_mace": "mace_1h",
    hammer: "mace_1h",
    club: "mace_1h",
    axe: "axe_1h",
    "1h_axe": "axe_1h",
    hatchet: "axe_1h",
    greataxe: "axe_1h",
    raidriar: "mace_1h",
    infinity_blade: "mace_1h",
    god_king: "mace_1h"
  };
  if (aliases[raw]) return aliases[raw];
  if (raw.includes("sword") && raw.includes("shield")) return "sword_shield";
  return raw;
}
var LOCO_BAKED = {
  idle: "locomotion/idle",
  walk: "locomotion/walking",
  run: "locomotion/running",
  jump: "locomotion/jump",
  warcry: "locomotion/standing taunt battlecry"
};

// src/animSources.ts
var ANIM_SOURCE_ROOTS = [
  {
    id: "unity_mixamo_library",
    label: "Original Unity / Mixamo animation library",
    pipeline: "unity_mixamo_to_bip001",
    skeleton: "mixamo",
    localPath: "C:\\Users\\nugye\\Documents\\animator\\animator\\public\\anim\\animations",
    pathHint: "Documents/animator/.../public/anim/animations",
    output: "fbx",
    clipsOnly: true,
    notes: "~252 FBX: sword, greatsword, bow, pistol, block, reactions (fly-back, get-up, knock), extra dash. Retarget Mixamo\u2192Bip001."
  },
  {
    id: "opb_adio_pistol",
    label: "OPB Adio \u2014 pistol / crossbow / gunfight clips",
    pipeline: "opb_clips_only",
    skeleton: "opb",
    localPath: "D:\\Games\\Models\\one_piece_bounty_rush_adio.glb",
    pathHint: "D:/Games/Models/one_piece_bounty_rush_adio.glb",
    output: "glb_embedded",
    clipsOnly: true,
    notes: "Primary gunfight source. 30 clips: idle/run/combo/skill/dodge/jump/damage/down/blownback/stun. r_weapon_joint for pistols. Harvest clips only \u2014 not a fleet hero mesh."
  },
  {
    id: "raidriar_infinity_blade",
    label: "Raidriar God King (Infinity Blade) \u2014 1H mace / axe retarget",
    pipeline: "raidriar_bmf_to_bip001",
    skeleton: "b_mf",
    localPath: "D:\\Games\\Models\\raidriar_the_god_king_-_infinity_blade.glb",
    pathHint: "D:/Games/Models/raidriar_the_god_king_-_infinity_blade.glb",
    output: "glb_embedded",
    clipsOnly: true,
    notes: "10 Action Stash clips on b_MF_* skeleton. Retarget B_MF_TO_BIP001 for grudge6. Use for 1H mace + 1H axe attacks. Weapon bones: b_MF_Weapon_R/L. Not a fleet hero mesh."
  },
  {
    id: "flare_opb_clip_harvest",
    label: "Flare OPB GLBs \u2014 clip harvest only (no heroes)",
    pipeline: "opb_clips_only",
    skeleton: "opb",
    localPath: "F:\\GitHub\\Flare-Boss-Arena\\Flare-Boss-Arena\\artifacts\\grudge-game\\public\\models\\skins",
    pathHint: "Flare skins + attached_assets OPB GLBs",
    output: "glb_embedded",
    clipsOnly: true,
    notes: "Do NOT use as playable heroes. Extract _idle/_run/_combo/_skill/_damage/_dodge and reaction-like clips; retarget or play on matching OPB-rig adapters only. Prefer Adio for pistol."
  },
  {
    id: "flare_kaykit_clip_harvest",
    label: "Flare KayKit anim libraries \u2014 clips only",
    pipeline: "kaykit_clips_only",
    skeleton: "kaykit",
    localPath: "F:\\GitHub\\Flare-Boss-Arena\\Flare-Boss-Arena\\artifacts\\grudge-game\\public\\models\\kaykit",
    pathHint: "kaykit/anim/*.glb + anim-ext/* (not heroes/)",
    output: "glb_library",
    clipsOnly: true,
    notes: "Harvest movement/combat/dodge clips from anim/ and anim-ext/. Ignore heroes/*.glb as character product."
  },
  {
    id: "fleet_baked_bip001",
    label: "Fleet baked Bip001 JSON clips",
    pipeline: "baked_bip001",
    skeleton: "bip001",
    pathHint: "/anims/baked + assets.grudge-studio.com/anims/baked",
    output: "baked_json",
    clipsOnly: true,
    notes: "Production SSOT for grudge6. Prefer same-origin first."
  }
];
var ADIO_CLIP_SUFFIX = {
  idle: ["_idle_a", "_idlehome_a"],
  run: ["_run"],
  attack: ["_combo_a", "_combo_b", "_combo_c"],
  skill: ["_skill_a", "_skill_b"],
  dodge: ["_dodge"],
  jump: ["_jump"],
  jumpLp: ["_jump_lp"],
  land: ["_jump_end"],
  damage: ["_damage"],
  down: ["_down"],
  getup: ["_down_end"],
  blownback: ["_blownback_lp"],
  blownbackEnd: ["_blownback_end"],
  slam: ["_slammed"],
  stun: ["_stun"],
  boost: ["_boost"],
  shock: ["_electric_shock"]
};
var ADIO_CLIPS = [
  "pl_adio_orig01_idle_a",
  "pl_adio_orig01_skill_a",
  "pl_adio_orig01_skill_b",
  "pl_adio_orig01_flagget",
  "pl_adio_orig01_boost",
  "pl_adio_orig01_dodge",
  "pl_adio_orig01_jump",
  "pl_adio_orig01_jump_lp",
  "pl_adio_orig01_jump_end",
  "pl_adio_orig01_damage",
  "pl_adio_orig01_flagget_lp",
  "pl_adio_orig01_flagget_end",
  "pl_adio_orig01_down",
  "pl_adio_orig01_down_end",
  "pl_adio_orig01_slammed",
  "pl_adio_orig01_opening",
  "pl_adio_orig01_victory",
  "pl_adio_orig01_lose",
  "pl_adio_orig01_stun",
  "pl_adio_orig01_idlehome_a",
  "pl_adio_orig01_blownback_lp",
  "pl_adio_orig01_blownback_end",
  "pl_adio_orig01_electric_shock",
  "pl_adio_orig01_shake",
  "pl_adio_orig01_run",
  "pl_adio_orig01_combo_a",
  "pl_adio_orig01_combo_b",
  "pl_adio_orig01_combo_c",
  "pl_adio_orig01_victory_lp",
  "pl_adio_orig01_lose_lp"
];
var ADIO_WEAPON_JOINTS = [
  "r_weapon_joint_049",
  "l_weapon_joint_042",
  "r_hand_weapon_01",
  "r_hand_weapon_02",
  "l_hand_weapon_01",
  "l_hand_weapon_02"
];
function getAnimSource(id) {
  return ANIM_SOURCE_ROOTS.find((s) => s.id === id);
}
function sourcesByPipeline(pipeline) {
  return ANIM_SOURCE_ROOTS.filter((s) => s.pipeline === pipeline);
}
function clipHarvestSources() {
  return ANIM_SOURCE_ROOTS.filter((s) => s.clipsOnly);
}
var UNITY_MIXAMO_FOLDERS = [
  "block",
  "bow",
  "climb",
  "combo",
  "extra",
  "farming",
  "gestures",
  "greataxe",
  "greatsword",
  "knife",
  "mace",
  "magic",
  "magic-loco",
  "pistol",
  "reactions",
  "rifle",
  "spear",
  "striker",
  "swim",
  "sword"
];
var RAIDRIAR_GLB = "D:/Games/Models/raidriar_the_god_king_-_infinity_blade.glb";
var RAIDRIAR_CLIPS = [
  "[Action Stash]",
  "[Action Stash].001",
  "[Action Stash].002",
  "[Action Stash].003",
  "[Action Stash].004",
  "[Action Stash].005",
  "[Action Stash].006",
  "[Action Stash].007",
  "[Action Stash].008",
  "[Action Stash].009"
];
var RAIDRIAR_ROLE_MAP = {
  /** Often base / combat idle */
  idle: "[Action Stash]",
  attack1: "[Action Stash].001",
  attack2: "[Action Stash].002",
  attack3: "[Action Stash].003",
  skill_a: "[Action Stash].004",
  skill_b: "[Action Stash].005",
  /** Heavy / slam style — good 1H mace */
  attack_heavy: "[Action Stash].006",
  hit: "[Action Stash].007",
  /** Finisher / spin — good 1H axe */
  skill_finisher: "[Action Stash].008",
  death: "[Action Stash].009"
};
var RAIDRIAR_WEAPON_BONES = [
  "b_MF_Weapon_R_29",
  "b_MF_Hand_R_30",
  "b_MF_Weapon_L_17",
  "b_MF_Hand_L_18"
];

// src/animPacks.ts
function c(key, sourceFolder, priority = 0, sourceGlb) {
  return { key, sourceFolder, priority, sourceGlb };
}
var ADIO = "D:/Games/Models/one_piece_bounty_rush_adio.glb";
function adio(name, priority = 0) {
  return {
    key: name,
    sourceFolder: "adio",
    sourceGlb: ADIO,
    priority
  };
}
function raidriar(name, priority = 0) {
  return {
    key: name,
    sourceFolder: "raidriar",
    sourceGlb: RAIDRIAR_GLB,
    priority
  };
}
var DEFAULT_DIRECTIONAL = {
  idle: "idle",
  forward: "run",
  back: "walk_back",
  left: "strafe_left",
  right: "strafe_right",
  forward_left: "run",
  forward_right: "run",
  back_left: "walk_back",
  back_right: "walk_back"
};
var PACK_SWORD_SHIELD = {
  id: "sword_shield",
  label: "Sword & Shield",
  skeleton: "bip001",
  sourceRootId: "fleet_baked_bip001",
  bakeStatus: "production_baked",
  tags: ["melee", "1h", "shield", "grudge6"],
  clips: {
    idle: [c(LOCO_BAKED.idle), c("sword_shield/sword and shield idle")],
    walk: [c(LOCO_BAKED.walk)],
    run: [c(LOCO_BAKED.run), c("sword_shield/sword and shield run")],
    jump: [c(LOCO_BAKED.jump)],
    warcry: [c(LOCO_BAKED.warcry)],
    attack1: [
      c("sword_shield/sword and shield attack"),
      c("sword_shield/sword and shield slash")
    ],
    attack2: [
      c("sword_shield/sword and shield attack (2)"),
      c("sword_shield/sword and shield slash 1")
    ],
    cast: [c("sword_shield/sword and shield casting")],
    death: [c("sword_shield/sword and shield death")],
    hit: [c("magic/Standing React Small From Front")]
  },
  directional: { ...DEFAULT_DIRECTIONAL, forward: "run" },
  skills: [
    {
      skillId: "ss_slash",
      name: "Slash",
      role: "attack1",
      candidates: [c("sword_shield/sword and shield slash")],
      blendOnLocomotion: true,
      upperBodyWeight: 0.95,
      hitWindow: [0.28, 0.55],
      rangeM: 2.5,
      cooldownS: 0.35
    },
    {
      skillId: "ss_slash2",
      name: "Slash 2",
      role: "attack2",
      candidates: [c("sword_shield/sword and shield attack (2)")],
      blendOnLocomotion: true,
      upperBodyWeight: 0.95,
      hitWindow: [0.28, 0.55],
      rangeM: 2.6,
      cooldownS: 0.4
    }
  ]
};
var PACK_REACTIONS = {
  id: "reactions",
  label: "Knockback / Flyback / Get-up / Stun",
  skeleton: "bip001",
  sourceRootId: "unity_mixamo_library",
  bakeStatus: "needs_bake",
  clipsOnly: true,
  tags: ["reaction", "cc", "hitstun", "knockback", "getup"],
  notes: "Bake Unity reactions FBX \u2192 Bip001. Adio blownback/down are OPB-rig harvest for gunfight adapters.",
  clips: {
    hit: [
      c("reactions/hit-to-head.fbx", "reactions"),
      c("reactions/big-body-blow.fbx", "reactions"),
      adio("pl_adio_orig01_damage", 2)
    ],
    knockback: [
      c("reactions/big-body-blow.fbx", "reactions"),
      c("reactions/jump-away.fbx", "reactions"),
      c("reactions/jogging-stumble.fbx", "reactions")
    ],
    flyback: [
      c("reactions/flying-back.fbx", "reactions"),
      c("reactions/knocked-up-and-back.fbx", "reactions"),
      adio("pl_adio_orig01_blownback_lp", 1)
    ],
    flyback_loop: [
      adio("pl_adio_orig01_blownback_lp"),
      c("reactions/falling-idle.fbx", "reactions")
    ],
    flyback_end: [
      adio("pl_adio_orig01_blownback_end"),
      c("reactions/fallen.fbx", "reactions")
    ],
    down: [
      c("reactions/fallen.fbx", "reactions"),
      c("reactions/knocked-out.fbx", "reactions"),
      adio("pl_adio_orig01_down")
    ],
    getup: [
      c("reactions/get-up.fbx", "reactions"),
      c("extra/corkscrew-kip-up.fbx", "extra"),
      adio("pl_adio_orig01_down_end")
    ],
    slam: [
      c("reactions/knocked-up.fbx", "reactions"),
      c("reactions/wall-crash.fbx", "reactions"),
      adio("pl_adio_orig01_slammed")
    ],
    stun: [
      c("reactions/stunned.fbx", "reactions"),
      adio("pl_adio_orig01_stun"),
      adio("pl_adio_orig01_electric_shock", 1),
      adio("pl_adio_orig01_shake", 2)
    ],
    death: [
      c("reactions/knocked-unconscious.fbx", "reactions"),
      c("reactions/fallen.fbx", "reactions")
    ]
  },
  skills: [
    {
      skillId: "react_hit",
      name: "Hit React",
      role: "hit",
      candidates: [c("reactions/hit-to-head.fbx", "reactions")],
      blendOnLocomotion: false,
      reaction: true,
      cooldownS: 0.2
    },
    {
      skillId: "react_flyback",
      name: "Fly Back",
      role: "flyback",
      candidates: [c("reactions/flying-back.fbx", "reactions")],
      blendOnLocomotion: false,
      reaction: true,
      cooldownS: 0.5
    },
    {
      skillId: "react_getup",
      name: "Get Up",
      role: "getup",
      candidates: [c("reactions/get-up.fbx", "reactions")],
      blendOnLocomotion: false,
      reaction: true,
      cooldownS: 0.1
    }
  ]
};
var PACK_BLOCK = {
  id: "block",
  label: "Block & Parry",
  skeleton: "bip001",
  sourceRootId: "unity_mixamo_library",
  bakeStatus: "needs_bake",
  clipsOnly: true,
  tags: ["block", "parry", "defense"],
  clips: {
    block_idle: [c("block/standing-block-idle.fbx", "block")],
    block: [
      c("block/left-block.fbx", "block"),
      c("block/right-block.fbx", "block")
    ],
    block_react: [
      c("block/block-react-large.fbx", "block"),
      c("block/standing-block-react-large.fbx", "block"),
      c("block/great-sword-impact.fbx", "block")
    ],
    parry: [
      c("block/parry.fbx", "block"),
      c("reactions/parry.fbx", "reactions")
    ]
  },
  skills: [
    {
      skillId: "block_hold",
      name: "Block",
      role: "block",
      candidates: [c("block/standing-block-idle.fbx", "block")],
      blendOnLocomotion: true,
      upperBodyWeight: 0.85,
      cooldownS: 0
    },
    {
      skillId: "parry",
      name: "Parry",
      role: "parry",
      candidates: [c("block/parry.fbx", "block")],
      blendOnLocomotion: false,
      hitWindow: [0.1, 0.35],
      cooldownS: 0.8
    }
  ]
};
var PACK_PISTOL = {
  id: "pistol",
  label: "Pistol / Gunfight (Adio + Unity)",
  skeleton: "opb",
  sourceRootId: "opb_adio_pistol",
  bakeStatus: "clip_harvest",
  clipsOnly: true,
  tags: ["ranged", "pistol", "gun", "adio", "opb_clips"],
  notes: `Primary source ${ADIO}. Combos/skills/dodge/jump for pistol fighting. Unity pistol/ pack bakes to Bip001 for grudge6 kits. Attach pistols to r_weapon_joint.`,
  clips: {
    idle: [
      adio("pl_adio_orig01_idle_a"),
      adio("pl_adio_orig01_idlehome_a", 1),
      c("pistol/idle.fbx", "pistol", 2)
    ],
    run: [adio("pl_adio_orig01_run"), c("pistol/run-forward.fbx", "pistol", 1)],
    walk: [c("pistol/walk-forward.fbx", "pistol"), adio("pl_adio_orig01_run", 1)],
    walk_back: [c("pistol/walk-backward.fbx", "pistol")],
    run_back: [c("pistol/run-backward.fbx", "pistol")],
    strafe_left: [
      c("pistol/strafe-left.fbx", "pistol"),
      c("pistol/run-arc-left.fbx", "pistol", 1)
    ],
    strafe_right: [
      c("pistol/strafe-right.fbx", "pistol"),
      c("pistol/run-arc-right.fbx", "pistol", 1)
    ],
    jump: [adio("pl_adio_orig01_jump"), c("pistol/pistol-jump.fbx", "pistol", 1)],
    jump_loop: [adio("pl_adio_orig01_jump_lp")],
    land: [adio("pl_adio_orig01_jump_end")],
    dash: [adio("pl_adio_orig01_dodge")],
    dodge_f: [adio("pl_adio_orig01_dodge")],
    attack1: [adio("pl_adio_orig01_combo_a"), c("pistol/gunplay.fbx", "pistol", 1)],
    attack2: [adio("pl_adio_orig01_combo_b"), c("pistol/pistol-whip.fbx", "pistol", 1)],
    attack3: [adio("pl_adio_orig01_combo_c"), c("pistol/charged-pistol.fbx", "pistol", 1)],
    skill_a: [adio("pl_adio_orig01_skill_a")],
    skill_b: [adio("pl_adio_orig01_skill_b")],
    fire: [adio("pl_adio_orig01_combo_a"), c("pistol/gunplay.fbx", "pistol", 1)],
    aim: [c("pistol/idle.fbx", "pistol"), adio("pl_adio_orig01_idle_a", 1)],
    draw: [c("pistol/drawing-gun.fbx", "pistol")],
    hit: [adio("pl_adio_orig01_damage")],
    stun: [adio("pl_adio_orig01_stun")],
    flyback_loop: [adio("pl_adio_orig01_blownback_lp")],
    flyback_end: [adio("pl_adio_orig01_blownback_end")],
    down: [adio("pl_adio_orig01_down")],
    getup: [adio("pl_adio_orig01_down_end")],
    boost: [adio("pl_adio_orig01_boost")]
  },
  directional: {
    ...DEFAULT_DIRECTIONAL,
    left: "strafe_left",
    right: "strafe_right",
    back: "walk_back"
  },
  skills: [
    {
      skillId: "pistol_fire",
      name: "Fire",
      role: "fire",
      candidates: [adio("pl_adio_orig01_combo_a")],
      blendOnLocomotion: true,
      upperBodyWeight: 0.9,
      hitWindow: [0.2, 0.45],
      rangeM: 35,
      cooldownS: 0.25
    },
    {
      skillId: "pistol_combo_b",
      name: "Combo B",
      role: "attack2",
      candidates: [adio("pl_adio_orig01_combo_b")],
      blendOnLocomotion: true,
      rangeM: 30,
      cooldownS: 0.4
    },
    {
      skillId: "pistol_skill_a",
      name: "Skill A",
      role: "skill_a",
      candidates: [adio("pl_adio_orig01_skill_a")],
      blendOnLocomotion: false,
      rangeM: 40,
      cooldownS: 1.5
    },
    {
      skillId: "pistol_skill_b",
      name: "Skill B",
      role: "skill_b",
      candidates: [adio("pl_adio_orig01_skill_b")],
      blendOnLocomotion: false,
      rangeM: 40,
      cooldownS: 2
    },
    {
      skillId: "pistol_dodge",
      name: "Dodge",
      role: "dash",
      candidates: [adio("pl_adio_orig01_dodge")],
      blendOnLocomotion: false,
      locomotionSkill: true,
      cooldownS: 0.9
    },
    {
      skillId: "pistol_whip",
      name: "Pistol Whip",
      role: "attack2",
      candidates: [c("pistol/pistol-whip.fbx", "pistol")],
      blendOnLocomotion: false,
      rangeM: 1.8,
      cooldownS: 0.6
    }
  ]
};
var PACK_CROSSBOW = {
  id: "crossbow",
  label: "Crossbow / Xbow",
  skeleton: "opb",
  sourceRootId: "opb_adio_pistol",
  bakeStatus: "clip_harvest",
  clipsOnly: true,
  tags: ["ranged", "crossbow", "xbow", "adio", "bow"],
  notes: "Uses Adio combat clips for fighting loop + Unity bow aim/shoot for Bip001 bake path. Pistol pack skills shared where fire cadence matches.",
  clips: {
    idle: [adio("pl_adio_orig01_idle_a"), c("bow/standing-idle-01.fbx", "bow", 1)],
    run: [adio("pl_adio_orig01_run")],
    walk: [c("bow/standing-walk-forward.fbx", "bow")],
    aim: [
      c("bow/standing-aim-overdraw.fbx", "bow"),
      adio("pl_adio_orig01_idle_a", 1)
    ],
    fire: [
      c("bow/shooting-arrow.fbx", "bow"),
      adio("pl_adio_orig01_combo_a", 1)
    ],
    attack1: [adio("pl_adio_orig01_combo_a"), c("bow/shooting-arrow.fbx", "bow", 1)],
    skill_a: [adio("pl_adio_orig01_skill_a"), c("bow/standing-aim-overdraw.fbx", "bow", 1)],
    skill_b: [adio("pl_adio_orig01_skill_b")],
    dash: [adio("pl_adio_orig01_dodge")],
    dodge_f: [c("bow/standing-dodge-forward.fbx", "bow"), adio("pl_adio_orig01_dodge", 1)],
    dodge_b: [c("bow/standing-dodge-backward.fbx", "bow")],
    dodge_l: [c("bow/standing-dodge-left.fbx", "bow")],
    dodge_r: [c("bow/standing-dodge-right.fbx", "bow")],
    hit: [adio("pl_adio_orig01_damage")],
    draw: [c("bow/standing-equip-bow.fbx", "bow"), c("pistol/drawing-gun.fbx", "pistol", 1)]
  },
  skills: [
    {
      skillId: "xbow_shot",
      name: "Crossbow Shot",
      role: "fire",
      candidates: [c("bow/shooting-arrow.fbx", "bow"), adio("pl_adio_orig01_combo_a", 1)],
      blendOnLocomotion: false,
      hitWindow: [0.35, 0.55],
      rangeM: 32,
      cooldownS: 0.7
    },
    {
      skillId: "xbow_skill",
      name: "Power Bolt",
      role: "skill_a",
      candidates: [adio("pl_adio_orig01_skill_a")],
      blendOnLocomotion: false,
      rangeM: 40,
      cooldownS: 2
    },
    {
      skillId: "xbow_dodge",
      name: "Dodge",
      role: "dash",
      candidates: [adio("pl_adio_orig01_dodge")],
      blendOnLocomotion: false,
      locomotionSkill: true,
      cooldownS: 0.9
    }
  ]
};
var PACK_DASH = {
  id: "dash",
  label: "Dash & Evade",
  skeleton: "bip001",
  sourceRootId: "unity_mixamo_library",
  bakeStatus: "needs_bake",
  clipsOnly: true,
  tags: ["mobility", "dodge", "dash", "mixamo"],
  notes: "Unity extra/ + bow dodges. Adio dodge also listed on pistol pack.",
  clips: {
    dash: [
      c("extra/running-slide.fbx", "extra", 0),
      c("extra/quick-roll-to-run.fbx", "extra", 1),
      adio("pl_adio_orig01_dodge", 2)
    ],
    dodge_f: [
      c("bow/standing-dodge-forward.fbx", "bow"),
      c("extra/aerial-evade.fbx", "extra")
    ],
    dodge_b: [
      c("bow/standing-dodge-backward.fbx", "bow"),
      c("extra/corkscrew-evade.fbx", "extra")
    ],
    dodge_l: [c("bow/standing-dodge-left.fbx", "bow")],
    dodge_r: [c("bow/standing-dodge-right.fbx", "bow")],
    jump: [c("extra/jump-up.fbx", "extra")]
  },
  skills: [
    {
      skillId: "dash_slide",
      name: "Running Slide",
      role: "dash",
      candidates: [c("extra/running-slide.fbx", "extra")],
      blendOnLocomotion: false,
      locomotionSkill: true,
      cooldownS: 1.2
    },
    {
      skillId: "dash_roll",
      name: "Quick Roll",
      role: "dash",
      candidates: [c("extra/quick-roll-to-run.fbx", "extra")],
      blendOnLocomotion: false,
      locomotionSkill: true,
      cooldownS: 1
    }
  ]
};
var PACK_SAMURAI = {
  id: "samurai",
  label: "Samurai / Greatsword",
  skeleton: "bip001",
  sourceRootId: "unity_mixamo_library",
  bakeStatus: "needs_bake",
  clipsOnly: true,
  tags: ["melee", "2h", "samurai", "greatsword", "mixamo"],
  notes: "Unity greatsword/sword only. No Flare hero meshes.",
  clips: {
    idle: [c("greatsword/great-sword-idle.fbx", "greatsword")],
    walk: [c("greatsword/great-sword-walk.fbx", "greatsword")],
    run: [c("greatsword/great-sword-run.fbx", "greatsword")],
    attack1: [
      c("greatsword/great-sword-slash.fbx", "greatsword"),
      c("sword/inward-slash.fbx", "sword")
    ],
    attack2: [
      c("greatsword/great-sword-slash-2.fbx", "greatsword"),
      c("sword/outward-slash.fbx", "sword")
    ],
    attack3: [
      c("greatsword/great-sword-high-spin-attack.fbx", "greatsword"),
      c("greatsword/great-sword-combo.fbx", "greatsword")
    ],
    skill_a: [
      c("greatsword/great-sword-jump-attack.fbx", "greatsword"),
      c("sword/slash-advance.fbx", "sword")
    ],
    skill_b: [c("greatsword/great-sword-overhead.fbx", "greatsword")],
    block: [c("greatsword/great-sword-blocking.fbx", "greatsword")],
    death: [c("greatsword/two-handed-sword-death.fbx", "greatsword")],
    draw: [c("greatsword/draw-great-sword-1.fbx", "greatsword")]
  },
  skills: [
    {
      skillId: "samurai_slash",
      name: "Katana Slash",
      role: "attack1",
      candidates: [c("greatsword/great-sword-slash.fbx", "greatsword")],
      blendOnLocomotion: true,
      upperBodyWeight: 0.92,
      hitWindow: [0.3, 0.55],
      rangeM: 2.8,
      cooldownS: 0.4
    },
    {
      skillId: "samurai_spin",
      name: "High Spin",
      role: "attack3",
      candidates: [c("greatsword/great-sword-high-spin-attack.fbx", "greatsword")],
      blendOnLocomotion: false,
      hitWindow: [0.25, 0.7],
      rangeM: 3.2,
      cooldownS: 1.5
    }
  ]
};
var PACK_LONGBOW = {
  id: "longbow",
  label: "Longbow",
  skeleton: "bip001",
  sourceRootId: "unity_mixamo_library",
  bakeStatus: "partial",
  clipsOnly: true,
  tags: ["ranged", "bow"],
  clips: {
    idle: [c("bow/standing-idle-01.fbx", "bow")],
    walk: [c("bow/standing-walk-forward.fbx", "bow")],
    run: [c("bow/standing-run-forward.fbx", "bow")],
    walk_back: [c("bow/standing-walk-back.fbx", "bow")],
    walk_left: [c("bow/standing-walk-left.fbx", "bow")],
    walk_right: [c("bow/standing-walk-right.fbx", "bow")],
    run_back: [c("bow/standing-run-back.fbx", "bow")],
    run_left: [c("bow/standing-run-left.fbx", "bow")],
    run_right: [c("bow/standing-run-right.fbx", "bow")],
    attack1: [c("bow/shooting-arrow.fbx", "bow")],
    aim: [c("bow/standing-aim-overdraw.fbx", "bow")],
    fire: [c("bow/shooting-arrow.fbx", "bow")],
    dodge_f: [c("bow/standing-dodge-forward.fbx", "bow")],
    dodge_b: [c("bow/standing-dodge-backward.fbx", "bow")],
    dodge_l: [c("bow/standing-dodge-left.fbx", "bow")],
    dodge_r: [c("bow/standing-dodge-right.fbx", "bow")]
  },
  directional: {
    idle: "idle",
    forward: "run",
    back: "walk_back",
    left: "walk_left",
    right: "walk_right",
    forward_left: "run_left",
    forward_right: "run_right",
    back_left: "walk_back",
    back_right: "walk_back"
  },
  skills: [
    {
      skillId: "bow_shot",
      name: "Shoot",
      role: "fire",
      candidates: [c("bow/shooting-arrow.fbx", "bow")],
      blendOnLocomotion: false,
      hitWindow: [0.35, 0.5],
      rangeM: 28,
      cooldownS: 0.5
    }
  ]
};
var PACK_MAGIC = {
  id: "magic",
  label: "Magic",
  skeleton: "bip001",
  sourceRootId: "unity_mixamo_library",
  bakeStatus: "partial",
  clipsOnly: true,
  tags: ["magic", "caster"],
  clips: {
    idle: [c("magic-loco/standing-idle.fbx", "magic-loco")],
    walk: [c("magic-loco/standing-walk-forward.fbx", "magic-loco")],
    run: [c("magic-loco/standing-run-forward.fbx", "magic-loco")],
    cast: [c("magic/casting-spell.fbx", "magic")],
    attack1: [c("magic/standing-1h-magic-attack-01.fbx", "magic")],
    attack2: [c("magic/standing-1h-magic-attack-02.fbx", "magic")],
    skill_a: [c("magic/standing-2h-magic-area-attack-01.fbx", "magic")]
  },
  skills: [
    {
      skillId: "magic_cast",
      name: "Cast",
      role: "cast",
      candidates: [c("magic/casting-spell.fbx", "magic")],
      blendOnLocomotion: false,
      hitWindow: [0.4, 0.65],
      rangeM: 18,
      cooldownS: 0.8
    }
  ]
};
var PACK_MACE_1H = {
  id: "mace_1h",
  label: "1H Mace",
  skeleton: "bip001",
  sourceRootId: "raidriar_infinity_blade",
  bakeStatus: "needs_bake",
  clipsOnly: true,
  tags: ["melee", "1h", "mace", "raidriar", "retarget"],
  notes: `Primary: ${RAIDRIAR_GLB} via B_MF_TO_BIP001. Secondary Unity mace/ hell-slammer. Not Raidriar mesh as hero.`,
  clips: {
    idle: [
      raidriar(RAIDRIAR_ROLE_MAP.idle),
      c(LOCO_BAKED.idle, "locomotion", 1)
    ],
    walk: [c(LOCO_BAKED.walk)],
    run: [c(LOCO_BAKED.run)],
    attack1: [
      raidriar(RAIDRIAR_ROLE_MAP.attack1),
      c("mace/hell-slammer-a.fbx", "mace", 1)
    ],
    attack2: [
      raidriar(RAIDRIAR_ROLE_MAP.attack2),
      c("mace/hell-slammer-b.fbx", "mace", 1)
    ],
    attack3: [raidriar(RAIDRIAR_ROLE_MAP.attack3)],
    skill_a: [
      raidriar(RAIDRIAR_ROLE_MAP.attack_heavy),
      raidriar(RAIDRIAR_ROLE_MAP.skill_a, 1),
      c("mace/hell-slammer-a.fbx", "mace", 2)
    ],
    skill_b: [raidriar(RAIDRIAR_ROLE_MAP.skill_b)],
    hit: [raidriar(RAIDRIAR_ROLE_MAP.hit)],
    death: [raidriar(RAIDRIAR_ROLE_MAP.death)]
  },
  skills: [
    {
      skillId: "mace_swing",
      name: "Mace Swing",
      role: "attack1",
      candidates: [raidriar(RAIDRIAR_ROLE_MAP.attack1)],
      blendOnLocomotion: true,
      upperBodyWeight: 0.95,
      hitWindow: [0.28, 0.55],
      rangeM: 2.4,
      cooldownS: 0.4
    },
    {
      skillId: "mace_swing2",
      name: "Mace Swing 2",
      role: "attack2",
      candidates: [raidriar(RAIDRIAR_ROLE_MAP.attack2)],
      blendOnLocomotion: true,
      upperBodyWeight: 0.95,
      hitWindow: [0.28, 0.55],
      rangeM: 2.5,
      cooldownS: 0.45
    },
    {
      skillId: "mace_slam",
      name: "Hell Slam",
      role: "skill_a",
      candidates: [
        raidriar(RAIDRIAR_ROLE_MAP.attack_heavy),
        c("mace/hell-slammer-a.fbx", "mace", 1)
      ],
      blendOnLocomotion: false,
      hitWindow: [0.35, 0.65],
      rangeM: 2.8,
      cooldownS: 1.2
    },
    {
      skillId: "mace_slam_b",
      name: "Hell Slam B",
      role: "skill_b",
      candidates: [
        c("mace/hell-slammer-b.fbx", "mace"),
        raidriar(RAIDRIAR_ROLE_MAP.skill_b, 1)
      ],
      blendOnLocomotion: false,
      hitWindow: [0.35, 0.65],
      rangeM: 2.8,
      cooldownS: 1.4
    }
  ]
};
var PACK_AXE_1H = {
  id: "axe_1h",
  label: "1H Axe",
  skeleton: "bip001",
  sourceRootId: "raidriar_infinity_blade",
  bakeStatus: "needs_bake",
  clipsOnly: true,
  tags: ["melee", "1h", "axe", "raidriar", "retarget"],
  notes: `Primary: ${RAIDRIAR_GLB} via B_MF_TO_BIP001. Finisher uses Action Stash .008. greataxe combo as secondary bake candidate.`,
  clips: {
    idle: [
      raidriar(RAIDRIAR_ROLE_MAP.idle),
      c(LOCO_BAKED.idle, "locomotion", 1)
    ],
    walk: [c(LOCO_BAKED.walk)],
    run: [c(LOCO_BAKED.run)],
    attack1: [raidriar(RAIDRIAR_ROLE_MAP.attack1)],
    attack2: [raidriar(RAIDRIAR_ROLE_MAP.attack2)],
    attack3: [raidriar(RAIDRIAR_ROLE_MAP.attack3)],
    skill_a: [
      raidriar(RAIDRIAR_ROLE_MAP.skill_finisher),
      c("greataxe/great-axe-combo.fbx", "greataxe", 1)
    ],
    skill_b: [raidriar(RAIDRIAR_ROLE_MAP.skill_a)],
    hit: [raidriar(RAIDRIAR_ROLE_MAP.hit)],
    death: [raidriar(RAIDRIAR_ROLE_MAP.death)]
  },
  skills: [
    {
      skillId: "axe_chop",
      name: "Axe Chop",
      role: "attack1",
      candidates: [raidriar(RAIDRIAR_ROLE_MAP.attack1)],
      blendOnLocomotion: true,
      upperBodyWeight: 0.95,
      hitWindow: [0.3, 0.55],
      rangeM: 2.5,
      cooldownS: 0.4
    },
    {
      skillId: "axe_chop2",
      name: "Axe Chop 2",
      role: "attack2",
      candidates: [raidriar(RAIDRIAR_ROLE_MAP.attack2)],
      blendOnLocomotion: true,
      upperBodyWeight: 0.95,
      hitWindow: [0.3, 0.55],
      rangeM: 2.6,
      cooldownS: 0.45
    },
    {
      skillId: "axe_cleave",
      name: "Cleave",
      role: "attack3",
      candidates: [raidriar(RAIDRIAR_ROLE_MAP.attack3)],
      blendOnLocomotion: false,
      hitWindow: [0.28, 0.6],
      rangeM: 2.9,
      cooldownS: 0.8
    },
    {
      skillId: "axe_finisher",
      name: "Axe Finisher",
      role: "skill_a",
      candidates: [
        raidriar(RAIDRIAR_ROLE_MAP.skill_finisher),
        c("greataxe/great-axe-combo.fbx", "greataxe", 1)
      ],
      blendOnLocomotion: false,
      hitWindow: [0.3, 0.7],
      rangeM: 3,
      cooldownS: 1.5
    }
  ]
};
var PACK_OPB_CLIPS = {
  id: "opb_clips",
  label: "OPB Clip Harvest (scheme only)",
  skeleton: "opb",
  sourceRootId: "opb_adio_pistol",
  bakeStatus: "clip_harvest",
  clipsOnly: true,
  tags: ["opb", "clips_only", "harvest", "no_hero"],
  notes: "Suffix scheme for extracting clips from OPB GLBs. Prefer Adio for gun. Never register Flare skins as playable heroes.",
  clips: {
    idle: [c("_idle_a"), c("_idlehome_a")],
    run: [c("_run")],
    walk: [c("_run")],
    attack1: [c("_combo_a"), c("_combo_b"), c("_combo_c")],
    skill_a: [c("_skill_a")],
    skill_b: [c("_skill_b")],
    dash: [c("_dodge")],
    jump: [c("_jump")],
    land: [c("_jump_end")],
    hit: [c("_damage")],
    down: [c("_down")],
    getup: [c("_down_end")],
    flyback_loop: [c("_blownback_lp")],
    flyback_end: [c("_blownback_end")],
    stun: [c("_stun")],
    slam: [c("_slammed")]
  },
  skills: []
};
var PACK_KAYKIT_CLIPS = {
  id: "kaykit_clips",
  label: "KayKit Library Clips",
  skeleton: "kaykit",
  sourceRootId: "flare_kaykit_clip_harvest",
  bakeStatus: "library_shared",
  clipsOnly: true,
  tags: ["kaykit", "clips_only", "no_hero"],
  notes: "anim/*.glb + anim-ext only. Do not use kaykit/heroes as fleet characters.",
  clips: {
    idle: [c("Idle"), c("idle")],
    walk: [c("Walking_A"), c("Walk")],
    run: [c("Running_A"), c("Run")],
    jump: [c("Jump_Start"), c("Jump")],
    dash: [c("Dodge_Forward"), c("Dodge"), c("Roll")],
    attack1: [c("1H_Melee_Attack_Chop"), c("Attack")],
    cast: [c("Spellcast_Shoot")],
    hit: [c("Hit_A"), c("Hit")],
    death: [c("Death_A"), c("Death")]
  },
  skills: [
    {
      skillId: "kaykit_dodge",
      name: "Dodge",
      role: "dash",
      candidates: [c("Dodge_Forward")],
      blendOnLocomotion: false,
      locomotionSkill: true,
      cooldownS: 0.9
    }
  ]
};
var PACK_OPB_NATIVE = PACK_OPB_CLIPS;
var PACK_KAYKIT = PACK_KAYKIT_CLIPS;
var ANIM_PACKS = [
  PACK_SWORD_SHIELD,
  PACK_REACTIONS,
  PACK_BLOCK,
  PACK_PISTOL,
  PACK_CROSSBOW,
  PACK_MACE_1H,
  PACK_AXE_1H,
  PACK_DASH,
  PACK_SAMURAI,
  PACK_LONGBOW,
  PACK_MAGIC,
  PACK_OPB_CLIPS,
  PACK_KAYKIT_CLIPS
];
function getAnimPack(id) {
  const nid = normalizeAnimPackId(id);
  const hit = ANIM_PACKS.find((p) => p.id === nid);
  if (hit) return hit;
  if (nid === "2h_melee" || nid === "greatsword") return PACK_SAMURAI;
  if (nid === "opb_native" || nid === "opb") return PACK_OPB_CLIPS;
  if (nid === "kaykit") return PACK_KAYKIT_CLIPS;
  if (nid === "gun" || nid === "handgun") return PACK_PISTOL;
  if (nid === "xbow") return PACK_CROSSBOW;
  if (nid === "mace" || nid === "1h_mace") return PACK_MACE_1H;
  if (nid === "axe" || nid === "1h_axe" || nid === "hatchet") return PACK_AXE_1H;
  return PACK_SWORD_SHIELD;
}
function raidriarClipInventory() {
  return Object.values(RAIDRIAR_ROLE_MAP);
}
function listAnimPackIds() {
  return ANIM_PACKS.map((p) => p.id);
}
function packsNeedingBake() {
  return ANIM_PACKS.filter(
    (p) => p.bakeStatus === "needs_bake" || p.bakeStatus === "partial"
  );
}
function packsClipsOnly() {
  return ANIM_PACKS.filter((p) => p.clipsOnly);
}
function resolveClipCandidates(packId, role) {
  return getAnimPack(packId).clips[role] ?? [];
}
function withSharedReactions(packId) {
  const base = getAnimPack(packId);
  const react = PACK_REACTIONS.clips;
  return { ...react, ...base.clips };
}
function directionalSlotFromXZ(x, z, deadzone = 0.12) {
  const mag = Math.hypot(x, z);
  if (mag < deadzone) return "idle";
  const angle = Math.atan2(x, z);
  const deg = angle * 180 / Math.PI;
  if (deg >= -22.5 && deg < 22.5) return "forward";
  if (deg >= 22.5 && deg < 67.5) return "forward_right";
  if (deg >= 67.5 && deg < 112.5) return "right";
  if (deg >= 112.5 && deg < 157.5) return "back_right";
  if (deg >= 157.5 || deg < -157.5) return "back";
  if (deg >= -157.5 && deg < -112.5) return "back_left";
  if (deg >= -112.5 && deg < -67.5) return "left";
  return "forward_left";
}
function clipRoleForDirection(packId, slot) {
  const pack = getAnimPack(packId);
  const map = pack.directional ?? DEFAULT_DIRECTIONAL;
  return map[slot] ?? (slot === "idle" ? "idle" : "run");
}
function bakeJobsForPack(packId) {
  const pack = getAnimPack(packId);
  if (pack.skeleton === "opb" || pack.skeleton === "kaykit") ;
  const jobs = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (label, key) => {
    if (!key.endsWith(".fbx")) return;
    if (seen.has(key)) return;
    seen.add(key);
    const clean = key.replace(/\.fbx$/i, "").replace(/\\/g, "/");
    jobs.push({
      packId: pack.id,
      skillOrRole: label,
      inputRel: key,
      outputKey: `anims/baked/${pack.id}/${clean.split("/").pop()}`,
      rotationOnly: true
    });
  };
  for (const [role, cands] of Object.entries(pack.clips)) {
    for (const cand of cands ?? []) add(role, cand.key);
  }
  for (const sk of pack.skills) {
    for (const cand of sk.candidates) add(sk.skillId, cand.key);
  }
  return jobs;
}
function adioClipInventory() {
  return ADIO_CLIPS;
}

// src/weaponSkillAnims.ts
var SKILL_BLEND_PROFILES = {
  melee_upper: {
    kind: "melee_upper",
    upperBodyWeight: 0.95,
    allowLocomotion: true,
    skillLocoRetain: 0.55,
    fadeIn: 0.08,
    fadeOut: 0.12,
    hitWindow: [0.28, 0.55],
    weaponCollider: true,
    boneMask: "upperBody",
    continuousGait: true
  },
  melee_full: {
    kind: "melee_full",
    upperBodyWeight: 1,
    allowLocomotion: false,
    skillLocoRetain: 0.12,
    fadeIn: 0.1,
    fadeOut: 0.15,
    hitWindow: [0.3, 0.65],
    weaponCollider: true,
    boneMask: "full",
    continuousGait: false
  },
  ranged: {
    kind: "ranged",
    upperBodyWeight: 1,
    allowLocomotion: false,
    skillLocoRetain: 0.1,
    fadeIn: 0.1,
    fadeOut: 0.15,
    hitWindow: [0.35, 0.5],
    weaponCollider: false,
    boneMask: "upperBody",
    continuousGait: false
  },
  magic: {
    kind: "magic",
    upperBodyWeight: 1,
    allowLocomotion: false,
    skillLocoRetain: 0.1,
    fadeIn: 0.12,
    fadeOut: 0.18,
    hitWindow: [0.4, 0.65],
    weaponCollider: false,
    boneMask: "upperBody"
  },
  mobility: {
    kind: "mobility",
    upperBodyWeight: 1,
    allowLocomotion: false,
    skillLocoRetain: 0.08,
    fadeIn: 0.05,
    fadeOut: 0.1,
    hitWindow: [0.1, 0.85],
    weaponCollider: false,
    locomotionSkill: true,
    boneMask: "full"
  },
  block: {
    kind: "block",
    upperBodyWeight: 0.85,
    allowLocomotion: true,
    skillLocoRetain: 0.65,
    fadeIn: 0.06,
    fadeOut: 0.1,
    hitWindow: [0, 1],
    weaponCollider: false,
    boneMask: "upperBody",
    continuousGait: true
  },
  parry: {
    kind: "parry",
    upperBodyWeight: 1,
    allowLocomotion: false,
    skillLocoRetain: 0.15,
    fadeIn: 0.04,
    fadeOut: 0.1,
    hitWindow: [0.1, 0.35],
    weaponCollider: false,
    boneMask: "upperBody"
  },
  reaction: {
    kind: "reaction",
    upperBodyWeight: 1,
    allowLocomotion: false,
    skillLocoRetain: 0.05,
    fadeIn: 0.05,
    fadeOut: 0.15,
    hitWindow: [0, 1],
    weaponCollider: false,
    reaction: true,
    boneMask: "full"
  },
  finisher: {
    kind: "finisher",
    upperBodyWeight: 1,
    allowLocomotion: false,
    skillLocoRetain: 0.08,
    fadeIn: 0.1,
    fadeOut: 0.18,
    hitWindow: [0.3, 0.7],
    weaponCollider: true,
    boneMask: "full"
  }
};
function inferSkillBlendKind(skill) {
  if (skill.reaction) return "reaction";
  if (skill.locomotionSkill) return "mobility";
  const id = skill.skillId.toLowerCase();
  const role = skill.role;
  if (role === "parry" || id.includes("parry")) return "parry";
  if (role === "block" || role === "block_idle" || id.includes("block")) {
    return "block";
  }
  if (role === "hit" || role === "knockback" || role === "flyback" || role === "getup" || role === "down" || role === "stun" || role === "slam" || id.includes("react")) {
    return "reaction";
  }
  if (role === "dash" || role === "dodge_f" || id.includes("dodge") || id.includes("dash")) {
    return "mobility";
  }
  if (role === "cast" || id.includes("magic") || id.includes("cast")) return "magic";
  if (role === "fire" || role === "aim" || id.includes("bow") || id.includes("pistol") || id.includes("xbow") || id.includes("shot")) {
    return "ranged";
  }
  if (role === "skill_a" || role === "skill_b" || id.includes("slam") || id.includes("finisher") || id.includes("spin") || id.includes("cleave")) {
    if (skill.blendOnLocomotion === false) return "finisher";
    return "melee_full";
  }
  if (skill.blendOnLocomotion === false) return "melee_full";
  return "melee_upper";
}
function resolveSkillBlendProfile(skill, kind) {
  const k = kind ?? inferSkillBlendKind(skill);
  const base = { ...SKILL_BLEND_PROFILES[k] };
  if (skill.upperBodyWeight != null) base.upperBodyWeight = skill.upperBodyWeight;
  if (skill.blendOnLocomotion != null) base.allowLocomotion = skill.blendOnLocomotion;
  if (skill.hitWindow) base.hitWindow = skill.hitWindow;
  if (skill.locomotionSkill != null) base.locomotionSkill = skill.locomotionSkill;
  if (skill.reaction != null) base.reaction = skill.reaction;
  return base;
}
function weaponSkillsForPack(packId) {
  const pack = getAnimPack(packId);
  return pack.skills.map((sk, i) => {
    const blend = resolveSkillBlendProfile(sk);
    return {
      skillId: sk.skillId,
      name: sk.name,
      animPack: pack.id,
      role: sk.role,
      candidates: sk.candidates,
      blend,
      rangeM: sk.rangeM ?? defaultRangeForKind(blend.kind),
      cooldownS: sk.cooldownS ?? defaultCdForKind(blend.kind),
      slotHint: i < 4 ? i + 1 : void 0
    };
  });
}
function listAllWeaponSkillAnims() {
  const out = [];
  for (const p of ANIM_PACKS) {
    if (p.skills.length === 0) continue;
    out.push(...weaponSkillsForPack(p.id));
  }
  return out;
}
function combatSkillKit(weaponPackId) {
  const base = weaponSkillsForPack(weaponPackId);
  const extra = [
    ...weaponSkillsForPack("reactions"),
    ...weaponSkillsForPack("block"),
    ...weaponSkillsForPack("dash")
  ];
  const seen = new Set(base.map((s) => s.skillId));
  for (const s of extra) {
    if (!seen.has(s.skillId)) {
      base.push(s);
      seen.add(s.skillId);
    }
  }
  return base;
}
function defaultRangeForKind(k) {
  switch (k) {
    case "ranged":
      return 28;
    case "magic":
      return 18;
    case "mobility":
    case "reaction":
    case "block":
    case "parry":
      return 0;
    case "finisher":
      return 3;
    case "melee_full":
      return 2.8;
    default:
      return 2.5;
  }
}
function defaultCdForKind(k) {
  switch (k) {
    case "melee_upper":
      return 0.35;
    case "melee_full":
      return 0.9;
    case "finisher":
      return 1.5;
    case "ranged":
      return 0.5;
    case "magic":
      return 0.8;
    case "mobility":
      return 0.9;
    case "parry":
      return 0.8;
    case "block":
      return 0;
    case "reaction":
      return 0.2;
    default:
      return 0.4;
  }
}
function toWeaponSkillPayload(entry) {
  const b = entry.blend;
  return {
    id: entry.skillId,
    name: entry.name,
    animPack: entry.animPack,
    upperBodyWeight: b.upperBodyWeight,
    allowLocomotion: b.allowLocomotion,
    fadeIn: b.fadeIn,
    fadeOut: b.fadeOut,
    hitWindow: b.hitWindow,
    rangeM: entry.rangeM,
    cooldownS: entry.cooldownS,
    weaponCollider: b.weaponCollider,
    locomotionSkill: b.locomotionSkill,
    reaction: b.reaction,
    blendKind: b.kind,
    skillLocoRetain: b.skillLocoRetain,
    boneMask: b.boneMask,
    preferredClipKey: entry.candidates[0]?.key ?? "",
    candidates: entry.candidates
  };
}
function describeSkillBlend(entry) {
  const b = entry.blend;
  return `${entry.skillId} [${b.kind}] upper=${b.upperBodyWeight} loco=${b.allowLocomotion ? "blend" : "freeze"} retain=${b.skillLocoRetain} hit=${b.hitWindow[0]}-${b.hitWindow[1]} fade=${b.fadeIn}/${b.fadeOut}s collider=${b.weaponCollider}${b.locomotionSkill ? " DASH" : ""}${b.reaction ? " REACT" : ""}`;
}
function formatWeaponSkillAnimCatalog(packId) {
  const list = packId ? weaponSkillsForPack(packId) : listAllWeaponSkillAnims();
  const lines = [`=== Weapon skill anims (${list.length}) ===`];
  let cur = "";
  for (const e of list) {
    if (e.animPack !== cur) {
      cur = e.animPack;
      lines.push(`
# ${cur}`);
    }
    lines.push(`  ${describeSkillBlend(e)}  range=${e.rangeM}m cd=${e.cooldownS}s`);
    lines.push(`    clips: ${e.candidates.map((c2) => c2.key).join(" | ")}`);
  }
  return lines.join("\n");
}

// src/animDebug.ts
function packLine(p) {
  const warnings = [];
  const roles = Object.keys(p.clips);
  if (!p.clips.idle && p.skeleton === "bip001") {
    warnings.push("missing idle");
  }
  if (!p.clips.walk && !p.clips.run && p.bakeStatus !== "needs_bake") {
    warnings.push("missing walk/run loco");
  }
  if (p.bakeStatus === "needs_bake") {
    warnings.push("FBX not baked \u2014 do not load raw Mixamo on Bip001");
  }
  if (p.skeleton === "opb" || p.skeleton === "kaykit") {
    warnings.push("native skeleton \u2014 do not rematch to Bip001");
  }
  if (p.skills.length === 0) warnings.push("no skill defs");
  const okForProduction = p.bakeStatus === "production_baked" || p.bakeStatus === "native_embedded" || p.bakeStatus === "library_shared";
  return {
    packId: p.id,
    label: p.label,
    skeleton: p.skeleton,
    bakeStatus: p.bakeStatus,
    sourceRootId: p.sourceRootId,
    clipRoles: roles,
    skillCount: p.skills.length,
    hasDirectional: !!p.directional,
    okForProduction,
    warnings
  };
}
function buildAnimSystemDebugReport() {
  const allSkills = listAllWeaponSkillAnims();
  const weaponSkillsByPack = {};
  for (const s of allSkills) {
    weaponSkillsByPack[s.animPack] = (weaponSkillsByPack[s.animPack] ?? 0) + 1;
  }
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sources: ANIM_SOURCE_ROOTS.map((s) => ({
      id: s.id,
      pipeline: s.pipeline,
      skeleton: s.skeleton,
      pathHint: s.pathHint
    })),
    packs: ANIM_PACKS.map(packLine),
    needsBake: packsNeedingBake().map((p) => p.id),
    weaponSkillCount: allSkills.length,
    weaponSkillsByPack,
    practices: [
      "Mixamo FBX \u2192 retarget MIXAMO_TO_BIP001 \u2192 strip hip-Y \u2192 bake JSON",
      "Flare/OPB/KayKit = CLIP HARVEST ONLY \u2014 not playable heroes",
      "Adio GLB for pistol/crossbow; Raidriar B_MF\u2192Bip001 for mace_1h/axe_1h",
      "Weapon skills: combatSkillKit + SKILL_BLEND_PROFILES + LocomotionCore",
      "Docs: packages/assets/docs/WEAPON_SKILL_BLENDS.md",
      "Reactions + block + dash shared via combatSkillKit",
      "Hit window drives colliders; base layer always locomotion",
      "Directional: directionalSlotFromXZ \u2192 clipRoleForDirection",
      "Never play unretargeted mixamorig tracks on Bip001 kits",
      "Prefer same-origin /anims/baked then assets CDN"
    ]
  };
}
function formatAnimDebugReport(report) {
  const r = report ?? buildAnimSystemDebugReport();
  const lines = [
    `=== Anim system debug (${r.generatedAt}) ===`,
    `Sources: ${r.sources.length}`,
    ...r.sources.map((s) => `  [${s.pipeline}] ${s.id} (${s.skeleton}) \u2192 ${s.pathHint}`),
    `Packs: ${r.packs.length}`
  ];
  for (const p of r.packs) {
    const flag = p.okForProduction ? "OK" : "WIP";
    lines.push(
      `  [${flag}] ${p.packId} skel=${p.skeleton} bake=${p.bakeStatus} skills=${p.skillCount} roles=${p.clipRoles.join(",")}`
    );
    for (const w of p.warnings) lines.push(`      ! ${w}`);
  }
  if (r.needsBake.length) {
    lines.push(`Needs bake: ${r.needsBake.join(", ")}`);
  }
  lines.push(`Weapon skills: ${r.weaponSkillCount}`);
  for (const [pack, n] of Object.entries(r.weaponSkillsByPack)) {
    lines.push(`  ${pack}: ${n}`);
  }
  lines.push("Practices:");
  for (const pr of r.practices) lines.push(`  \xB7 ${pr}`);
  return lines.join("\n");
}
function formatPackSkillDebug(packId) {
  const skills = weaponSkillsForPack(packId);
  return formatWeaponSkillAnimCatalog(packId) + `
(${skills.length} skills)`;
}
function missingRoles(packId, loadedRoles) {
  const pack = getAnimPack(packId);
  const have = new Set(loadedRoles);
  const want = Object.keys(pack.clips);
  return want.filter((r) => !have.has(r));
}
function blendPracticeHint(opts) {
  const w = opts.upperBodyWeight ?? 1;
  if (opts.locomotionSkill) {
    return `[${opts.skillId}] full-body mobility: locoScale\u22480.1\u20130.2 during dash; restore gait after fadeOut`;
  }
  if (opts.blendOnLocomotion && opts.moving) {
    return `[${opts.skillId}] upper-body blend: skillW=${w.toFixed(2)} retain loco\u22480.55\xD7(1-skill\xD70.5); continuous gait OK`;
  }
  if (opts.blendOnLocomotion) {
    return `[${opts.skillId}] standing skill: allowLocomotion true but speed\u22480 \u2192 idle under skill`;
  }
  return `[${opts.skillId}] full-body skill: freeze/reduce loco to ~0.12; no run blend until recovery`;
}
function directionalDebugLine(packId, x, z, slotFn, roleFn) {
  const slot = slotFn(x, z);
  const role = roleFn(packId, slot);
  return `dir xz=(${x.toFixed(2)},${z.toFixed(2)}) \u2192 slot=${slot} \u2192 role=${role} pack=${packId}`;
}
function formatLayerWeights(w) {
  return `loco=${w.locomotion.toFixed(2)} upper=${w.upper_body.toFixed(2)} full=${w.full_body_skill.toFixed(2)} add=${(w.additive ?? 0).toFixed(2)}`;
}

// src/animPractices.ts
var ANIM_DEBUG_PRACTICES = {
  /** Always log pack + skeleton + bakeStatus on character spawn */
  logPackOnSpawn: true,
  /** Prefer buildAnimSystemDebugReport() in /debug overlay */
  systemReport: "buildAnimSystemDebugReport | formatAnimDebugReport",
  /** Per-frame optional (dev only): layer weights + skill progress */
  frameHud: "formatLayerWeights(loco.layerWeights) + skillState",
  /** On skill fire: blendPracticeHint(...) */
  onSkill: "blendPracticeHint",
  /** Never silent-fail missing clips — list missingRoles() */
  missingClips: "missingRoles(packId, loaded)",
  /** Catalog hotbar skills + blends */
  skillCatalog: "formatWeaponSkillAnimCatalog(packId?) | describeSkillBlend"
};
var ANIM_DIRECTIONAL_PRACTICES = {
  /** Map stick/WASD to xz then directionalSlotFromXZ */
  input: "directionalSlotFromXZ(x, z) \u2192 clipRoleForDirection(pack, slot)",
  /** Prefer continuous gaitBlendFromSpeed when only forward speed */
  forwardOnly: "gaitBlendFromSpeed(speed01, sprinting) on idle/walk/run/sprint",
  /** When pack has 4/8-way clips (longbow), use directional roles */
  eightWay: "walk_left/right/back + run_* from pack.clips",
  /** Strafe: do not mirror left onto right without checking root facing */
  noBlindMirror: true,
  deadzone: 0.12
};
var ANIM_BLEND_PRACTICES = {
  /** Base layer always locomotion */
  baseLayer: "locomotion",
  /** Use SKILL_BLEND_PROFILES — do not invent retain numbers */
  profiles: "SKILL_BLEND_PROFILES / resolveSkillBlendProfile",
  /** Light melee while moving */
  melee_upper: "upper 0.95, allowLocomotion true, skillLocoRetain 0.55",
  /** Heavy / plant */
  melee_full: "upper 1, allowLocomotion false, retain ~0.12",
  /** Dash/roll/slide */
  mobility: "locomotionSkill, full body, fadeIn 0.05",
  /** Block hold can walk */
  block: "upper 0.85, retain 0.65",
  /** Reactions interrupt everything */
  reaction: "full body freeze, reaction: true",
  /** Runtime weights */
  weaponOnLoco: "skillOnLocoWeights / previewSkillLayerWeights",
  fadeInS: 0.08,
  fadeOutS: 0.12,
  hitWindowDefault: [0.28, 0.55],
  continuousGait: true,
  boneMasks: "BONE_MASK_GROUPS in @grudge-studio/animator",
  docs: "packages/assets/docs/WEAPON_SKILL_BLENDS.md"
};
var ANIM_WEAPON_SKILL_PRACTICES = {
  /** Kit = weapon pack + reactions + block + dash */
  kit: "combatSkillKit(weaponPackId)",
  /** Payload → LocomotionCore */
  play: "toWeaponSkillPayload \u2192 weaponSkillFromPayload(clip, payload) \u2192 playWeaponSkill",
  /** Collider only in hit window */
  collider: "skillState.inHitWindow && skillState.weaponColliderActive",
  /** State machine */
  state: "applyLocoSnapshot + combat states knockback/flyback/getup/block/parry",
  /** Pack skill fields */
  skillDef: "SkillClipDef: candidates, blendOnLocomotion, hitWindow, rangeM, cooldownS",
  /** Factories */
  factories: "makeMeleeSkill | makeRangedSkill | makeMobilitySkill | makeBlockSkill | makeReactionSkill | makeFinisherSkill"
};
var ANIM_PIPELINE_PRACTICES = {
  bip001Production: "Mixamo/Unity FBX \u2192 MIXAMO_TO_BIP001 \u2192 strip hip position \u2192 baked JSON",
  /** Flare / OPB / KayKit = clips only — never ship as fleet heroes */
  clipsOnlyFromFlare: true,
  noFlareHeroes: "Do not use Flare skins or KayKit heroes as playable characters",
  opb: "Harvest AnimationClips from OPB GLBs (prefer Adio for pistol). Suffix scheme.",
  adioPistol: "D:/Games/Models/one_piece_bounty_rush_adio.glb \u2192 pistol + crossbow packs",
  raidriarMaceAxe: "D:/Games/Models/raidriar_the_god_king_-_infinity_blade.glb \u2192 B_MF_TO_BIP001 \u2192 mace_1h + axe_1h",
  kaykit: "Harvest anim/*.glb libraries only \u2014 ignore heroes/",
  reactions: "Unity reactions/ + Adio blownback/down/getup \u2192 PACK_REACTIONS",
  blocks: "Unity block/ \u2192 PACK_BLOCK",
  kill: "unretargeted_mixamorig_on_bip001",
  sameOriginFirst: true
};
function animQualityChecklist() {
  return [
    "[ ] Pack id from getAnimPack / normalizeAnimPackId",
    "[ ] Skeleton matches pipeline (bip001 vs opb vs kaykit / b_mf retarget)",
    "[ ] Flare/OPB/KayKit/Raidriar used for clips only \u2014 no hero product",
    "[ ] Pistol/crossbow use Adio clip harvest",
    "[ ] Mace/axe use Raidriar + B_MF_TO_BIP001",
    "[ ] combatSkillKit includes reactions + block + dash",
    "[ ] Each skill has blend kind (SKILL_BLEND_PROFILES)",
    "[ ] Hit windows drive weapon colliders only",
    "[ ] LocomotionCore base gait + playWeaponSkill overlays",
    "[ ] Directional: directionalSlotFromXZ or gaitBlendFromSpeed",
    "[ ] Debug: formatWeaponSkillAnimCatalog + formatAnimDebugReport",
    "[ ] needs_bake packs not loaded as raw FBX on Bip001",
    "[ ] Same-origin baked URL tried first"
  ];
}
async function fetchObjectStoreJson(file, init) {
  const base = getFleetUrls().objectStore.replace(/\/$/, "");
  const name = file.endsWith(".json") ? file : `${file}.json`;
  const res = await fetch(`${base}/${name}`, init);
  if (!res.ok) throw new Error(`ObjectStore ${name}: ${res.status}`);
  return res.json();
}
var OBJECTSTORE_KEYS = [
  "weapons",
  "equipment",
  "materials",
  "races",
  "armor",
  "grudge6-gear-presets",
  "race-models.v1"
];

// src/bestPractices.ts
var ASSET_BEST_PRACTICES = {
  banMeshy: true,
  banPermanentCapsules: true,
  isolateMultiMeshPacks: true,
  preferSameOriginBakedAnims: true,
  magicByteCheckGlb: true,
  cdnSsot: "https://assets.grudge-studio.com",
  objectStoreSsot: "https://objectstore.grudge-studio.com/api/v1",
  grudge6Equip: "child-mesh visibility on Bip001 kit, not model swap",
  forgeDeployApp: "https://forge.grudge-studio.com",
  /** Quality SSOT monorepo */
  npmQualitySystem: "@grudge-studio/sdk + character/units/bake/deploy",
  /** Uniformed motion: strip hip/root .position on grounded kits */
  rotationOnlyGroundedAnims: true,
  /** Ground from skinned Box3 min.y — never pelvis.y */
  groundFromBodyBoxMinY: true,
  characterDeployPackage: "@grudge-studio/character",
  unitsNpcPackage: "@grudge-studio/units",
  bakePackage: "@grudge-studio/bake",
  deployPackage: "@grudge-studio/deploy",
  /** Anim asset management */
  animPackRegistry: "getAnimPack / ANIM_PACKS / animSources",
  animDebug: "buildAnimSystemDebugReport / formatAnimDebugReport",
  mixamoToBip001Only: true,
  noCrossSkeletonWithoutAdapter: true,
  /** Never promote Flare skins / KayKit heroes to fleet characters */
  flareClipsOnly: true,
  adioPistolSource: "D:/Games/Models/one_piece_bounty_rush_adio.glb",
  raidriarMaceAxeSource: "D:/Games/Models/raidriar_the_god_king_-_infinity_blade.glb",
  raidriarRetarget: "B_MF_TO_BIP001 / retargetRaidriarClipToBip001",
  directional: "directionalSlotFromXZ + clipRoleForDirection",
  blend: "LocomotionCore + skillOnLocoWeights + SKILL_BLEND_PROFILES",
  weaponSkills: "combatSkillKit \u2192 toWeaponSkillPayload \u2192 weaponSkillFromPayload",
  weaponSkillDocs: "packages/assets/docs/WEAPON_SKILL_BLENDS.md",
  sharedReactions: "withSharedReactions(packId) + PACK_REACTIONS + combatSkillKit"
};

export { ADIO_CLIPS, ADIO_CLIP_SUFFIX, ADIO_WEAPON_JOINTS, ANIM_BLEND_PRACTICES, ANIM_DEBUG_PRACTICES, ANIM_DIRECTIONAL_PRACTICES, ANIM_PACKS, ANIM_PIPELINE_PRACTICES, ANIM_SOURCE_ROOTS, ANIM_WEAPON_SKILL_PRACTICES, ASSET_BEST_PRACTICES, BAKED_ANIM_ARENA, DEFAULT_DIRECTIONAL, GRUDGE6_RACE_ATLAS, GRUDGE6_RACE_FBX, LOCO_BAKED, OBJECTSTORE_KEYS, PACK_AXE_1H, PACK_BLOCK, PACK_CROSSBOW, PACK_DASH, PACK_KAYKIT, PACK_KAYKIT_CLIPS, PACK_LONGBOW, PACK_MACE_1H, PACK_MAGIC, PACK_OPB_CLIPS, PACK_OPB_NATIVE, PACK_PISTOL, PACK_REACTIONS, PACK_SAMURAI, PACK_SWORD_SHIELD, RAIDRIAR_CLIPS, RAIDRIAR_GLB, RAIDRIAR_ROLE_MAP, RAIDRIAR_WEAPON_BONES, SKILL_BLEND_PROFILES, STYLIZED_NATURE, STYLIZED_VARIANTS, UNITY_MIXAMO_FOLDERS, adioClipInventory, animQualityChecklist, bakeJobsForPack, bakedAnimUrl, bakedAnimUrlCandidates, blendPracticeHint, buildAnimSystemDebugReport, clipHarvestSources, clipRoleForDirection, combatSkillKit, describeSkillBlend, directionalDebugLine, directionalSlotFromXZ, fetchObjectStoreJson, formatAnimDebugReport, formatLayerWeights, formatPackSkillDebug, formatWeaponSkillAnimCatalog, getAnimPack, getAnimSource, grudge6AtlasUrl, grudge6RaceUrl, inferSkillBlendKind, listAllWeaponSkillAnims, listAnimPackIds, missingRoles, natureUrl, normalizeAnimPackId, packsClipsOnly, packsNeedingBake, raidriarClipInventory, resolveClipCandidates, resolveSkillBlendProfile, sourcesByPipeline, toWeaponSkillPayload, weaponSkillsForPack, weaponToAnimPack, withSharedReactions };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map