// src/manifest.ts
function createDefaultManifest(id = "grudge-game", cdn = "https://assets.grudge-studio.com") {
  return {
    version: "0.2.0",
    pipeline: {
      cdn,
      r2: {
        unitPalette: `${cdn}/models/units/Color_Palette.png`,
        grudge6: `${cdn}/models/grudge6/`
      }
    },
    controllers: {
      id,
      worldScale: 1,
      playerHeight: 1.85,
      camFollow: 0.12,
      fov: 72
    },
    terrain: {
      cellSize: 1.7,
      ridgeHeight: 5.2,
      corridorHalf: 5,
      sampleRadius: 2
    }
  };
}

// src/boot.ts
function createEngineBoot(manifest, options = {}) {
  const cacheKey = options.cacheKey ?? `engine_boot_${manifest.controllers.id}`;
  options.cacheTtlMs ?? 36e5;
  const probeUrl = options.probeUrl ?? manifest.pipeline.r2.unitPalette ?? `${manifest.pipeline.cdn}/`;
  let state = {
    ready: false,
    manifest,
    cdnReachable: false,
    bootedAt: 0
  };
  async function bootEngine() {
    let cdnReachable = false;
    try {
      const res = await fetch(probeUrl, { method: "HEAD", mode: "cors" });
      cdnReachable = res.ok;
    } catch {
      cdnReachable = false;
    }
    state = {
      ready: true,
      manifest,
      cdnReachable,
      bootedAt: Date.now()
    };
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(cacheKey, JSON.stringify(state));
      }
    } catch {
    }
    return state;
  }
  function getEngine() {
    return state;
  }
  return { bootEngine, getEngine };
}

// src/terrain.ts
function sampleHeightmap(heights, cols, rows, width, length, x, z) {
  const halfW = width / 2;
  const halfL = length / 2;
  const u = (x + halfW) / width;
  const v = (z + halfL) / length;
  const c = Math.min(cols - 1, Math.max(0, Math.floor(u * (cols - 1))));
  const r = Math.min(rows - 1, Math.max(0, Math.floor(v * (rows - 1))));
  return heights[r * cols + c] ?? 0;
}
var PHYS_LAYERS = {
  Default: 0,
  Terrain: 1,
  Player: 2,
  NPC: 3,
  Item: 4,
  Projectile: 5,
  Trigger: 6,
  Water: 7,
  Ignore: 8
};

// src/physics.ts
var COLLIDER_CLASSES = [
  "cct",
  "heightfield",
  "convex",
  "trimesh",
  "followConvex",
  "sensor",
  "hurtbox"
];
var HUMAN_CCT = {
  /** SI metres — Open PLAYER_CAPSULE / Island3D addCharacterCapsule */
  radius: 0.35,
  halfHeight: 0.55,
  /** Skin; Island3D uses 0.01, Open 0.08 — hosts pick at createCharacterController */
  controllerOffset: 0.08,
  autostepHeight: 0.5,
  autostepMinWidth: 0.2,
  snapToGround: 0.5,
  maxSlopeClimbDeg: 45,
  minSlopeSlideDeg: 30,
  applyImpulsesToDynamic: true
};
var PHYSICS_DEFAULTS = {
  /** Rapier world gravity for dynamics / vehicles */
  gravityY: -9.81,
  /** CCT desired-Y gravity (Open CharacterCapsuleKcc / Controller) */
  characterGravityY: -12,
  fixedStep: 1 / 60,
  maxSubsteps: 5,
  characterHeightM: 1.8,
  capsuleRadiusM: HUMAN_CCT.radius,
  capsuleHalfHeightM: HUMAN_CCT.halfHeight,
  walkAuthority: "rapier-cct",
  pickAuthority: "three-mesh-bvh"
};
function capsuleCenterOffset(radius = HUMAN_CCT.radius, halfHeight = HUMAN_CCT.halfHeight) {
  return radius + halfHeight;
}
function configureRapierCharacterController(cct, opts = {}) {
  const c = { ...HUMAN_CCT, ...opts };
  cct.setUp?.({ x: 0, y: 1, z: 0 });
  cct.setMaxSlopeClimbAngle(c.maxSlopeClimbDeg * Math.PI / 180);
  cct.setMinSlopeSlideAngle(c.minSlopeSlideDeg * Math.PI / 180);
  cct.enableAutostep(c.autostepHeight, c.autostepMinWidth, true);
  cct.enableSnapToGround(c.snapToGround);
  cct.setApplyImpulsesToDynamicBodies(c.applyImpulsesToDynamic);
}
function applyGamepadDeadzone(v, zone = 0.18) {
  const a = Math.abs(v);
  if (a < zone) return 0;
  return Math.sign(v) * ((a - zone) / (1 - zone));
}
function readPhysicsDebugGate(search = typeof window !== "undefined" ? window.location.search : "", storageGet) {
  let query = false;
  try {
    const q = new URLSearchParams(search || "");
    query = q.get("physicsDebug") === "1" || q.get("rapierDebug") === "1";
    if (q.get("physicsDebug") === "0") {
      return { query: false, localStorage: false, enabled: false };
    }
  } catch {
  }
  let ls = false;
  try {
    const get = storageGet ?? ((k) => typeof localStorage !== "undefined" ? localStorage.getItem(k) : null);
    ls = get("grudge_physics_debug") === "1";
  } catch {
  }
  return { query, localStorage: ls, enabled: query || ls };
}
var PHYSICS_FLEET_SURFACES = [
  {
    id: "open-danger",
    host: "open.grudge-studio.com/danger",
    engine: "Controller.ts + CharacterCapsuleKcc",
    physics: "Rapier CCT"
  },
  {
    id: "client-island3d",
    host: "client.grudge-studio.com",
    engine: "Island3DEngine",
    physics: "PhysicsWorld.addCharacterCapsule + moveCharacter"
  },
  {
    id: "casting",
    host: "casting.grudge-studio.com",
    engine: "loadRaceKit + PhysicsWorld",
    physics: "Rapier CCT"
  },
  {
    id: "gladiators",
    host: "grudge-combat.vercel.app",
    engine: "combat lab",
    physics: "Rapier CCT"
  },
  {
    id: "mine-loader",
    host: "mineloader.grudge-studio.com",
    engine: "VoxelEngine",
    physics: "WorldPhysics + RapierHelper"
  },
  {
    id: "warlord-genesis",
    host: "warlords /edit + warcamp",
    engine: "R3F Game",
    physics: "@react-three/rapier Physics debug="
  }
];

// src/playtest.ts
var PLAYTEST_WITH_CONTROLLER = [
  {
    id: "open-danger",
    label: "Open Danger Room",
    url: "https://open.grudge-studio.com/danger",
    walk: "rapier-cct",
    controller: "Controller.ts + CharacterCapsuleKcc",
    notes: "Production play. WASD, mouse, C parry / X dodge. Gamepad if host wired."
  },
  {
    id: "casting",
    label: "Casting Warlords lab",
    url: "https://casting.grudge-studio.com/",
    walk: "rapier-cct",
    controller: "loadRaceKit + PhysicsWorld CCT",
    notes: "Toon play proof. WASD + Shift run, F skills. Alias casting-abilities-threejs.vercel.app"
  },
  {
    id: "casting-vercel",
    label: "Casting (Vercel)",
    url: "https://casting-abilities-threejs.vercel.app/",
    walk: "rapier-cct",
    controller: "same Casting kit",
    notes: "Always-on Vercel alias of Casting."
  },
  {
    id: "gladiators",
    label: "Grudge Gladiators",
    url: "https://grudge-combat.vercel.app/",
    walk: "rapier-cct",
    controller: "combat lab kit bake",
    notes: "Arena + /admin weapon skills. Not Open Danger."
  },
  {
    id: "warlords-client",
    label: "Warlords island",
    url: "https://client.grudge-studio.com/",
    walk: "rapier-cct",
    controller: "Island3D addCharacterCapsule + moveCharacter",
    notes: "Needs character UUID handoff from Foundry. SI 1.8 m."
  },
  {
    id: "grudgecontrol",
    label: "grudgecontrol lab",
    url: "https://grudgecontrol.vercel.app/",
    walk: "lab-cct",
    controller: "playerController + Rapier CCT (lab scale)",
    notes: "Harvest only. Mixamo 0.001 demos. Do not replace Controller.ts."
  },
  {
    id: "gst-play",
    label: "Dev Tool Native Play",
    url: "grudge-dev-tool /play",
    walk: "kinematic-preview",
    controller: "PlayRuntime (SceneEngine, no Rapier)",
    notes: "Desktop preview. Not production CCT."
  },
  {
    id: "grok-builder",
    label: "Grok Builder world",
    url: "https://grok-builder.vercel.app/",
    walk: "rapier-cct",
    controller: "R3F <Physics> + Rapier 0.19 (edit Orbit / play CCT)",
    notes: "Host pin SSOT: three 0.185.1, r3f 9.7, drei 10.7, @react-three/rapier 2.2. Vercel prebuilt + wrangler worker."
  }
];
function productionPlaytestUrl() {
  return PLAYTEST_WITH_CONTROLLER[0].url;
}

// src/hostStack.ts
var HOST_STACK = {
  source: "grok-builder",
  sourceUrl: "https://grok-builder.vercel.app",
  three: "^0.185.1",
  typesThree: "^0.185.4",
  rapierCompat: "^0.19.3",
  r3f: "^9.7.0",
  drei: "^10.7.8",
  r3fRapier: "^2.2.0",
  zustand: "^5.0.3",
  react: "^19.2.0"
};
var IMPERATIVE_HOST_DEPS = {
  three: HOST_STACK.three,
  "@dimforge/rapier3d-compat": HOST_STACK.rapierCompat,
  "three-mesh-bvh": "^0.9.0"
};
var R3F_HOST_DEPS = {
  three: HOST_STACK.three,
  "@react-three/fiber": HOST_STACK.r3f,
  "@react-three/drei": HOST_STACK.drei,
  "@react-three/rapier": HOST_STACK.r3fRapier,
  zustand: HOST_STACK.zustand
};

// src/quality.ts
var RUNTIME_3D_REQUIREMENTS = {
  three: HOST_STACK.three,
  typesThree: HOST_STACK.typesThree,
  physics: ["@dimforge/rapier3d-compat", "@react-three/rapier"],
  rapierCompat: HOST_STACK.rapierCompat,
  r3f: HOST_STACK.r3f,
  drei: HOST_STACK.drei,
  r3fRapier: HOST_STACK.r3fRapier,
  optionalBvh: "three-mesh-bvh",
  walk: "rapier-cct",
  pick: "three-mesh-bvh",
  optionalPathfinding: "three-pathfinding",
  stateUi: "zustand",
  qualityNpm: [
    "@grudge-studio/character",
    "@grudge-studio/animator",
    "@grudge-studio/units",
    "@grudge-studio/bake",
    "@grudge-studio/deploy"
  ]
};
function looksLike185(range) {
  if (!range) return false;
  return /0\.185/.test(range);
}
function assertRuntimeHints(pkg) {
  const all = { ...pkg.devDependencies, ...pkg.dependencies };
  const missing = [];
  if (!all.three) missing.push("three");
  else if (!looksLike185(all.three)) missing.push("three@^0.185 (stale pin)");
  const types = all["@types/three"];
  if (types && /0\.17[0-9]/.test(types)) missing.push("@types/three@^0.185.4 (0.170 defs are wrong for r185)");
  const hasRapier = !!all["@dimforge/rapier3d-compat"] || !!all["@react-three/rapier"] || !!all["@dimforge/rapier3d"];
  if (!hasRapier) missing.push("rapier");
  return { ok: missing.length === 0, missing };
}

// src/worldDeploy.ts
var WORLD_PHYSICS = {
  gravity: [0, -9.81, 0],
  timeStep: 1 / 60,
  oneWorld: true,
  walk: "rapier-cct",
  pick: "three-mesh-bvh",
  ground: "heightfield-or-fixed-cuboid-or-fixed-trimesh",
  playerShape: "capsule",
  ban: ["convex-hull-on-modular-hero", "dynamic-trimesh", "second-physics-world", "orbit-writing-play-camera"]
};
var WORLD_R3F = {
  canvas: "<Canvas shadows dpr={[1,2]} gl={{ antialias: true }}>",
  physics: "<Physics gravity={[0,-9.81,0]} timeStep={1/60} debug={physicsDebug}>",
  helpers: ["AdaptiveDpr", "Environment", "ContactShadows", "Grid 1m"],
  editCamera: "OrbitControls only while !playMode"
};
var WORLD_DEPLOY_HOSTS = {
  spa: "Vercel prebuilt (.vercel/output \u2192 prod alias)",
  worker: "wrangler deploy (AI / search only \u2014 no physics on the Worker)",
  binaries: "https://assets.grudge-studio.com",
  definitions: "https://objectstore.grudge-studio.com / https://info.grudge-studio.com",
  player: "Railway Postgres",
  editor: "https://forge.grudge-studio.com",
  grokBuilder: "https://grok-builder.vercel.app"
};
var WORLD_DEPLOY_CHECKLIST = [
  "[ ] three@^0.185.1 + @types/three@^0.185.4 (not 0.170 defs)",
  "[ ] Rapier: @dimforge/rapier3d-compat@^0.19.3 and/or @react-three/rapier@^2.2",
  "[ ] R3F world: @react-three/fiber@^9.7 + @react-three/drei@^10.7",
  "[ ] Single Physics world, fixed 1/60, gravity SI",
  "[ ] Player capsule CCT \u2014 not convex hull, not Meshy/capsule-hero mesh",
  "[ ] Ground = heightfield OR fixed cuboid OR fixed trimesh; same sample as feet",
  "[ ] Play camera sole writer; Orbit gated to edit",
  "[ ] One mixer; stripPositionTracks on grounded kits",
  "[ ] CDN binaries; ObjectStore/info definitions JSON; Railway player SSOT",
  "[ ] SPA: Vercel prebuilt; Worker: wrangler (no Rapier WASM on the edge)",
  "[ ] ?physicsDebug=1 gated \u2014 never forced on prod"
];
function worldDeployChecklist() {
  return WORLD_DEPLOY_CHECKLIST;
}

export { COLLIDER_CLASSES, HOST_STACK, HUMAN_CCT, IMPERATIVE_HOST_DEPS, PHYSICS_DEFAULTS, PHYSICS_FLEET_SURFACES, PHYS_LAYERS, PLAYTEST_WITH_CONTROLLER, R3F_HOST_DEPS, RUNTIME_3D_REQUIREMENTS, WORLD_DEPLOY_CHECKLIST, WORLD_DEPLOY_HOSTS, WORLD_PHYSICS, WORLD_R3F, applyGamepadDeadzone, assertRuntimeHints, capsuleCenterOffset, configureRapierCharacterController, createDefaultManifest, createEngineBoot, productionPlaytestUrl, readPhysicsDebugGate, sampleHeightmap, worldDeployChecklist };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map