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
}];
declare function productionPlaytestUrl(): string;

/**
 * Runtime 3D host expectations (pairs with @grudge-studio/deploy QUALITY_SYSTEM).
 */
declare const RUNTIME_3D_REQUIREMENTS: {
    readonly three: "^0.185";
    readonly physics: readonly ["@dimforge/rapier3d-compat", "@react-three/rapier"];
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

export { type EngineBootState, type EngineManifest, HUMAN_CCT, PHYSICS_DEFAULTS, PHYSICS_FLEET_SURFACES, PHYS_LAYERS, PLAYTEST_WITH_CONTROLLER, type PhysicsDebugGate, type PlaytestSurface, RUNTIME_3D_REQUIREMENTS, type RapierCharacterController, applyGamepadDeadzone, assertRuntimeHints, capsuleCenterOffset, configureRapierCharacterController, createDefaultManifest, createEngineBoot, productionPlaytestUrl, readPhysicsDebugGate, sampleHeightmap };
