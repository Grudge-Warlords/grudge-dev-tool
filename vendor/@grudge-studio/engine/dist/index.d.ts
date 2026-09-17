interface EngineManifest {
    version: string;
    pipeline: {
        cdn: string;
        r2: Record<string, string>;
        d1?: Record<string, string>;
    };
    controllers: {
        id: string;
        worldScale: number;
        playerHeight: number;
        camFollow: number;
        fov: number;
    };
    terrain: {
        cellSize: number;
        ridgeHeight: number;
        corridorHalf: number;
        sampleRadius: number;
    };
}
declare function createDefaultManifest(id?: string, cdn?: string): EngineManifest;

interface EngineBootState<M extends EngineManifest = EngineManifest> {
    ready: boolean;
    manifest: M;
    cdnReachable: boolean;
    bootedAt: number;
}
declare function createEngineBoot<M extends EngineManifest>(manifest: M, options?: {
    cacheKey?: string;
    cacheTtlMs?: number;
    probeUrl?: string;
}): {
    bootEngine: () => Promise<EngineBootState<M>>;
    getEngine: () => EngineBootState<M>;
};

/** Sample height from a row-major heightmap (game units). */
declare function sampleHeightmap(heights: ArrayLike<number>, cols: number, rows: number, width: number, length: number, x: number, z: number): number;
/** Physics layer names (Forge / genesis convention). */
declare const PHYS_LAYERS: {
    readonly Default: 0;
    readonly Terrain: 1;
    readonly Player: 2;
    readonly NPC: 3;
    readonly Item: 4;
    readonly Projectile: 5;
    readonly Trigger: 6;
    readonly Water: 7;
    readonly Ignore: 8;
};

/**
 * @grudge-studio/engine physics SSOT — constants + CCT configure.
 *
 * WASM world still lives in the host (Island3D PhysicsWorld, Open
 * CharacterCapsuleKcc, Casting PhysicsWorld). This package does not
 * ship Rapier. Hosts call configureRapierCharacterController(cct).
 *
 * Walk = Rapier kinematic CCT. three-mesh-bvh = pick/camera only.
 */
/** Duck-typed Rapier KinematicCharacterController (avoid WASM in this package). */
type RapierCharacterController = {
    setUp?: (v: {
        x: number;
        y: number;
        z: number;
    }) => void;
    setMaxSlopeClimbAngle: (rad: number) => void;
    setMinSlopeSlideAngle: (rad: number) => void;
    enableAutostep: (maxHeight: number, minWidth: number, includeDynamics: boolean) => void;
    enableSnapToGround: (dist: number) => void;
    setApplyImpulsesToDynamicBodies: (on: boolean) => void;
};
/** Play collider classes — Casting / Island3D SSOT. Do not invent a second library. */
declare const COLLIDER_CLASSES: readonly ["cct", "heightfield", "convex", "trimesh", "followConvex", "sensor", "hurtbox"];
type ColliderClass = (typeof COLLIDER_CLASSES)[number];
declare const HUMAN_CCT: {
    /** SI metres — Open PLAYER_CAPSULE / Island3D addCharacterCapsule */
    readonly radius: 0.35;
    readonly halfHeight: 0.55;
    /** Skin; Island3D uses 0.01, Open 0.08 — hosts pick at createCharacterController */
    readonly controllerOffset: 0.08;
    readonly autostepHeight: 0.5;
    readonly autostepMinWidth: 0.2;
    readonly snapToGround: 0.5;
    readonly maxSlopeClimbDeg: 45;
    readonly minSlopeSlideDeg: 30;
    readonly applyImpulsesToDynamic: true;
};
declare const PHYSICS_DEFAULTS: {
    /** Rapier world gravity for dynamics / vehicles */
    readonly gravityY: -9.81;
    /** CCT desired-Y gravity (Open CharacterCapsuleKcc / Controller) */
    readonly characterGravityY: -12;
    readonly fixedStep: number;
    readonly maxSubsteps: 5;
    readonly characterHeightM: 1.8;
    readonly capsuleRadiusM: 0.35;
    readonly capsuleHalfHeightM: 0.55;
    readonly walkAuthority: "rapier-cct";
    readonly pickAuthority: "three-mesh-bvh";
};
declare function capsuleCenterOffset(radius?: 0.35, halfHeight?: 0.55): number;
/** Island3D / Casting law: gravity in desired movement, not RB forces. */
declare function configureRapierCharacterController(cct: RapierCharacterController, opts?: Partial<typeof HUMAN_CCT>): void;
declare function applyGamepadDeadzone(v: number, zone?: number): number;
type PhysicsDebugGate = {
    query: boolean;
    localStorage: boolean;
    enabled: boolean;
};
/** Shared gate used by every Grudge 3D client */
declare function readPhysicsDebugGate(search?: string | null | undefined, storageGet?: (key: string) => string | null): PhysicsDebugGate;
declare const PHYSICS_FLEET_SURFACES: readonly [{
    readonly id: "open-danger";
    readonly host: "open.grudge-studio.com/danger";
    readonly engine: "Controller.ts + CharacterCapsuleKcc";
    readonly physics: "Rapier CCT";
}, {
    readonly id: "client-island3d";
    readonly host: "client.grudge-studio.com";
    readonly engine: "Island3DEngine";
    readonly physics: "PhysicsWorld.addCharacterCapsule + moveCharacter";
}, {
    readonly id: "casting";
    readonly host: "casting.grudge-studio.com";
    readonly engine: "loadRaceKit + PhysicsWorld";
    readonly physics: "Rapier CCT";
}, {
    readonly id: "gladiators";
    readonly host: "grudge-combat.vercel.app";
    readonly engine: "combat lab";
    readonly physics: "Rapier CCT";
}, {
    readonly id: "mine-loader";
    readonly host: "mineloader.grudge-studio.com";
    readonly engine: "VoxelEngine";
    readonly physics: "WorldPhysics + RapierHelper";
}, {
    readonly id: "warlord-genesis";
    readonly host: "warlords /edit + warcamp";
    readonly engine: "R3F Game";
    readonly physics: "@react-three/rapier Physics debug=";
}];

/**
 * Where to playtest a controller — fleet hosts, not GST /play.
 * Live games own Rapier CCT + Controller.ts / loadRaceKit.
 */
type PlaytestSurface = {
    id: string;
    label: string;
    url: string;
    walk: "rapier-cct" | "lab-cct" | "kinematic-preview";
    controller: string;
    notes: string;
};
declare const PLAYTEST_WITH_CONTROLLER: readonly [{
    readonly id: "open-danger";
    readonly label: "Open Danger Room";
    readonly url: "https://open.grudge-studio.com/danger";
    readonly walk: "rapier-cct";
    readonly controller: "Controller.ts + CharacterCapsuleKcc";
    readonly notes: "Production play. WASD, mouse, C parry / X dodge. Gamepad if host wired.";
}, {
    readonly id: "casting";
    readonly label: "Casting Warlords lab";
    readonly url: "https://casting.grudge-studio.com/";
    readonly walk: "rapier-cct";
    readonly controller: "loadRaceKit + PhysicsWorld CCT";
    readonly notes: "Toon play proof. WASD + Shift run, F skills. Alias casting-abilities-threejs.vercel.app";
}, {
    readonly id: "casting-vercel";
    readonly label: "Casting (Vercel)";
    readonly url: "https://casting-abilities-threejs.vercel.app/";
    readonly walk: "rapier-cct";
    readonly controller: "same Casting kit";
    readonly notes: "Always-on Vercel alias of Casting.";
}, {
    readonly id: "gladiators";
    readonly label: "Grudge Gladiators";
    readonly url: "https://grudge-combat.vercel.app/";
    readonly walk: "rapier-cct";
    readonly controller: "combat lab kit bake";
    readonly notes: "Arena + /admin weapon skills. Not Open Danger.";
}, {
    readonly id: "warlords-client";
    readonly label: "Warlords island";
    readonly url: "https://client.grudge-studio.com/";
    readonly walk: "rapier-cct";
    readonly controller: "Island3D addCharacterCapsule + moveCharacter";
    readonly notes: "Needs character UUID handoff from Foundry. SI 1.8 m.";
}, {
    readonly id: "grudgecontrol";
    readonly label: "grudgecontrol lab";
    readonly url: "https://grudgecontrol.vercel.app/";
    readonly walk: "lab-cct";
    readonly controller: "playerController + Rapier CCT (lab scale)";
    readonly notes: "Harvest only. Mixamo 0.001 demos. Do not replace Controller.ts.";
}, {
    readonly id: "gst-play";
    readonly label: "Dev Tool Native Play";
    readonly url: "grudge-dev-tool /play";
    readonly walk: "kinematic-preview";
    readonly controller: "PlayRuntime (SceneEngine, no Rapier)";
    readonly notes: "Desktop preview. Not production CCT.";
}, {
    readonly id: "grok-builder";
    readonly label: "Grok Builder world";
    readonly url: "https://grok-builder.vercel.app/";
    readonly walk: "rapier-cct";
    readonly controller: "R3F <Physics> + Rapier 0.19 (edit Orbit / play CCT)";
    readonly notes: "Host pin SSOT: three 0.185.1, r3f 9.7, drei 10.7, @react-three/rapier 2.2. Vercel prebuilt + wrangler worker.";
}];
declare function productionPlaytestUrl(): string;

/**
 * Runtime 3D host expectations (pairs with @grudge-studio/deploy QUALITY_SYSTEM).
 * Pins match Grok Builder + fleet SSOT (three 0.185, Rapier 0.19).
 */
declare const RUNTIME_3D_REQUIREMENTS: {
    readonly three: "^0.185.1";
    readonly typesThree: "^0.185.4";
    readonly physics: readonly ["@dimforge/rapier3d-compat", "@react-three/rapier"];
    readonly rapierCompat: "^0.19.3";
    readonly r3f: "^9.7.0";
    readonly drei: "^10.7.8";
    readonly r3fRapier: "^2.2.0";
    readonly optionalBvh: "three-mesh-bvh";
    readonly walk: "rapier-cct";
    readonly pick: "three-mesh-bvh";
    readonly optionalPathfinding: "three-pathfinding";
    readonly stateUi: "zustand";
    readonly qualityNpm: readonly ["@grudge-studio/character", "@grudge-studio/animator", "@grudge-studio/units", "@grudge-studio/bake", "@grudge-studio/deploy"];
};
declare function assertRuntimeHints(pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}): {
    ok: boolean;
    missing: string[];
};

/**
 * Host npm pins harvested from Grok Builder (`F:\GitHub\grok-builder` package.json).
 * Fleet SSOT stays three ^0.185 — do not invent a second renderer pin.
 * WASM Rapier still lives in the host; this package only declares versions.
 */
declare const HOST_STACK: {
    readonly source: "grok-builder";
    readonly sourceUrl: "https://grok-builder.vercel.app";
    readonly three: "^0.185.1";
    readonly typesThree: "^0.185.4";
    readonly rapierCompat: "^0.19.3";
    readonly r3f: "^9.7.0";
    readonly drei: "^10.7.8";
    readonly r3fRapier: "^2.2.0";
    readonly zustand: "^5.0.3";
    readonly react: "^19.2.0";
};
type HostStackId = keyof typeof HOST_STACK;
/** Imperative Three host (Island3D / Open / Dev Tool Play). */
declare const IMPERATIVE_HOST_DEPS: {
    readonly three: "^0.185.1";
    readonly "@dimforge/rapier3d-compat": "^0.19.3";
    readonly "three-mesh-bvh": "^0.9.0";
};
/** R3F + Rapier host (Forge / Grok Builder / warcamp). */
declare const R3F_HOST_DEPS: {
    readonly three: "^0.185.1";
    readonly "@react-three/fiber": "^9.7.0";
    readonly "@react-three/drei": "^10.7.8";
    readonly "@react-three/rapier": "^2.2.0";
    readonly zustand: "^5.0.3";
};

/**
 * World deploy contract — harvested from Grok Builder GAME_SYSTEMS + STACK_HELPERS + DEPLOY.md.
 * Extend this file; do not invent a second deploy catalog in Dev Tool.
 */
declare const WORLD_PHYSICS: {
    readonly gravity: readonly [0, -9.81, 0];
    readonly timeStep: number;
    readonly oneWorld: true;
    readonly walk: "rapier-cct";
    readonly pick: "three-mesh-bvh";
    readonly ground: "heightfield-or-fixed-cuboid-or-fixed-trimesh";
    readonly playerShape: "capsule";
    readonly ban: readonly ["convex-hull-on-modular-hero", "dynamic-trimesh", "second-physics-world", "orbit-writing-play-camera"];
};
declare const WORLD_R3F: {
    readonly canvas: "<Canvas shadows dpr={[1,2]} gl={{ antialias: true }}>";
    readonly physics: "<Physics gravity={[0,-9.81,0]} timeStep={1/60} debug={physicsDebug}>";
    readonly helpers: readonly ["AdaptiveDpr", "Environment", "ContactShadows", "Grid 1m"];
    readonly editCamera: "OrbitControls only while !playMode";
};
declare const WORLD_DEPLOY_HOSTS: {
    readonly spa: "Vercel prebuilt (.vercel/output → prod alias)";
    readonly worker: "wrangler deploy (AI / search only — no physics on the Worker)";
    readonly binaries: "https://assets.grudge-studio.com";
    readonly definitions: "https://objectstore.grudge-studio.com / https://info.grudge-studio.com";
    readonly player: "Railway Postgres";
    readonly editor: "https://forge.grudge-studio.com";
    readonly grokBuilder: "https://grok-builder.vercel.app";
};
declare const WORLD_DEPLOY_CHECKLIST: readonly string[];
declare function worldDeployChecklist(): readonly string[];

export { COLLIDER_CLASSES, type ColliderClass, type EngineBootState, type EngineManifest, HOST_STACK, HUMAN_CCT, type HostStackId, IMPERATIVE_HOST_DEPS, PHYSICS_DEFAULTS, PHYSICS_FLEET_SURFACES, PHYS_LAYERS, PLAYTEST_WITH_CONTROLLER, type PhysicsDebugGate, type PlaytestSurface, R3F_HOST_DEPS, RUNTIME_3D_REQUIREMENTS, type RapierCharacterController, WORLD_DEPLOY_CHECKLIST, WORLD_DEPLOY_HOSTS, WORLD_PHYSICS, WORLD_R3F, applyGamepadDeadzone, assertRuntimeHints, capsuleCenterOffset, configureRapierCharacterController, createDefaultManifest, createEngineBoot, productionPlaytestUrl, readPhysicsDebugGate, sampleHeightmap, worldDeployChecklist };
