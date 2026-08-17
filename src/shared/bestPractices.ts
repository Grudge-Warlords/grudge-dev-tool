/**
 * Fleet + Cloudflare AI / D1 / R2 / Stream best practices.
 * Enforced in UI copy, agent system prompts, Forge tips, and Make & Deploy presets.
 *
 * Source skills: grudge-fleet, grudge-live-servers, grudge-production-wiring,
 * grudge-character-correctness, grudge-warlords-assets, grudge-d1-r2,
 * grudge-asset-convert, grudge-coder, forge-editor, workers-best-practices.
 *
 * Cloudflare product docs (retrieve before changing numeric limits):
 * - Workers AI + AI Gateway bindings
 * - D1 prepare/bind/batch
 * - R2 multipart + custom-domain cache
 * - Stream copy-from-URL / live encode
 */

export type BestPracticeCategory =
  | "fleet"
  | "ai"
  | "storage"
  | "media"
  | "pipeline"
  | "surfaces";

export interface BestPractice {
  id: string;
  title: string;
  rule: string;
  category: BestPracticeCategory;
  /** Dev Tool / product surfaces that should surface this tip */
  surfaces?: readonly string[];
}

// ─── Fleet (ONE TRUTH) ───────────────────────────────────────────────────────

export const FLEET_BEST_PRACTICES = {
  oneTruth: {
    id: "one-truth",
    title: "ONE TRUTH API base",
    rule: "Use https://client.grudge-studio.com as the sole browser/CLI API base (rewrites → Railway + ObjectStore + auth). api.grudge-studio.com may still answer asset-index GETs (legacy live) — do not use it for new player APIs or as SSOT; prefer objectstore + assets CDN.",
    category: "fleet" as const,
    surfaces: ["devtools", "ai", "deploy", "coder"] as const,
  },
  playerState: {
    id: "player-state",
    title: "Player state SSOT",
    rule: "Characters, bag, island, wallet write only to Railway Postgres (grudge-api-production-0d46). D1 is asset index only; Puter KV is cache.",
    category: "fleet" as const,
    surfaces: ["devtools", "ai", "deploy"] as const,
  },
  assets: {
    id: "assets-cdn",
    title: "Assets & catalogs",
    rule: "Binaries → assets.grudge-studio.com (R2), prefer prod/gltf/<cat>/*.glb. JSON catalogs → objectstore.grudge-studio.com/api/v1. Magic-byte verify GLBs; no HTML-as-mesh. Seed D1/ObjectStore after upload.",
    category: "fleet" as const,
    surfaces: ["devtools", "assets", "forge", "pipeline", "ai"] as const,
  },
  waterDomain: {
    id: "water-domain",
    title: "Water / Tactical Infinity domain",
    rule: "Production home island is https://water.grudge-studio.com only. Never tactical-infinity.vercel.app (orphaned).",
    category: "fleet" as const,
    surfaces: ["deploy", "devtools"] as const,
  },
  foundryFunnel: {
    id: "foundry-funnel",
    title: "Character Foundry funnel",
    rule: "character.grudge-studio.com is create + 4-slot only. Live play always handoff to client.grudge-studio.com.",
    category: "fleet" as const,
    surfaces: ["deploy", "devtools"] as const,
  },
  characterScale: {
    id: "character-scale",
    title: "SI character scale",
    rule: "grudge6 heroes at 1 SI human (~1.8 m). Verify feet on ground, hips, facing before fleet deploy.",
    category: "fleet" as const,
    surfaces: ["forge", "pipeline", "ai", "devtools"] as const,
  },
  websocket: {
    id: "websocket",
    title: "Realtime / PvP",
    rule: "Never hardcode wss hosts. Prefer same-origin /api/carrier. Vercel cannot upgrade WebSockets — use CF Worker edge (GRUDOX pattern).",
    category: "fleet" as const,
    surfaces: ["deploy", "ai"] as const,
  },
  deploy: {
    id: "deploy-pipeline",
    title: "Forge / asset deploy",
    rule: "Ingest → size-verify → convert (grudge-convert) → rig/UUID → R2 signed PUT → D1 registry seed → public CDN URL. Large GLBs never in git.",
    category: "fleet" as const,
    surfaces: ["pipeline", "forge", "assets", "ai", "devtools"] as const,
  },
  agentic: {
    id: "agentic-access",
    title: "Agentic AI access",
    rule: "Canonical admins (grudachain, molochdadev) auto-plug GRUDACHAIN Ollama. Cloud agents via ai.grudge-studio.com with Grudge ID / fleet key.",
    category: "fleet" as const,
    surfaces: ["ai", "devtools", "coder"] as const,
  },
  auth: {
    id: "auth-sso",
    title: "Auth / access",
    rule: "All apps SSO through id.grudge-studio.com (/login?redirect_uri=). CORS must include *.grudge-studio.com and localhost dev ports.",
    category: "fleet" as const,
    surfaces: ["deploy", "devtools", "coder"] as const,
  },
  noMeshy: {
    id: "no-meshy",
    title: "Canonical meshes only",
    rule: "Never ship Meshy/AI-generated heroes or permanent capsules. Load grudge6 / verified CDN packs only; placeholders must clear on load.",
    category: "fleet" as const,
    surfaces: ["assets", "forge", "pipeline", "ai"] as const,
  },
} as const satisfies Record<string, BestPractice>;

// ─── Cloudflare AI (Workers AI + AI Gateway + Legion + Coder hub) ────────────

export const AI_BEST_PRACTICES = {
  twoAiSurfaces: {
    id: "ai-two-surfaces",
    title: "Two AI surfaces (do not merge)",
    rule: "Fleet Legion chat/roles = ai.grudge-studio.com (grudge-ai-hub). Coder event/job ingest = GrudachainCode workers/ai-hub (D1 grudge-ai-hub). Dev Tool routes via aiWorkerManager + Ollama preference.",
    category: "ai" as const,
    surfaces: ["ai", "coder", "devtools"] as const,
  },
  bindingsOverRest: {
    id: "ai-bindings",
    title: "Workers AI: bindings over REST",
    rule: "Inside Workers use env.AI.run() with AI Gateway { id, skipCache, cacheTtl }. Never call Cloudflare REST from a Worker for the same account bindings. Desktop/CLI uses AI Gateway URL + cf-ai-workers-api secret.",
    category: "ai" as const,
    surfaces: ["ai", "coder", "deploy"] as const,
  },
  gatewayCache: {
    id: "ai-gateway-cache",
    title: "AI Gateway caching",
    rule: "Cache deterministic prompts (asset captions, classification, catalog enrich) with cacheTtl. skipCache:true for chat, agent tools, and user-specific jobs. Log feedback via gateway patchLog when available.",
    category: "ai" as const,
    surfaces: ["ai", "pipeline", "assets"] as const,
  },
  modelRouting: {
    id: "ai-model-routing",
    title: "Model routing for production quality",
    rule: "Workers AI (@cf/meta/llama-*) for cheap classify/search/caption. Claude/GPT via AI Gateway or Legion for code, bake plans, architecture. Coder: code→codex, deploy→nano, create→opus, gamedev→sonnet. Local Ollama for offline admin agentic.",
    category: "ai" as const,
    surfaces: ["ai", "coder", "devtools", "pipeline"] as const,
  },
  agentTools: {
    id: "ai-agent-tools",
    title: "AI Worker tool contract",
    rule: "Agents must only resolve assets via ObjectStore search (> query) / D1 registry / assets CDN. Tools: list R2, search D1, magic-byte verify, convert CLI, signed upload, seed registry, send-to-Forge. Ban inventing mesh paths.",
    category: "ai" as const,
    surfaces: ["ai", "assets", "forge", "devtools"] as const,
  },
  agentObservability: {
    id: "ai-observability",
    title: "AI telemetry",
    rule: "Push latency/tokens/status to obs.grudge-studio.com (obsPushAiEvent). Structured JSON logs in Workers; enable wrangler observability. Never log secrets or full JWT.",
    category: "ai" as const,
    surfaces: ["ai", "devtools", "coder"] as const,
  },
  agentsSdk: {
    id: "ai-agents-sdk",
    title: "Stateful agents (Agents SDK)",
    rule: "Long-running asset jobs / chat rooms use Cloudflare Agents SDK (DO + SQLite): setState, @callable, schedule, queue, runWorkflow. nodejs_compat on; never experimentalDecorators (breaks @callable).",
    category: "ai" as const,
    surfaces: ["ai", "coder", "pipeline"] as const,
  },
  secrets: {
    id: "ai-secrets",
    title: "AI secrets",
    rule: "wrangler secret put / keytar only. No API keys in client bundles. GRUDGE_AI_KEY / cf-ai-workers-api / Anthropic-OpenAI keys stay main-process or Worker env.",
    category: "ai" as const,
    surfaces: ["ai", "devtools", "deploy"] as const,
  },
} as const satisfies Record<string, BestPractice>;

// ─── D1 + R2 (asset index + binaries) ────────────────────────────────────────

export const STORAGE_BEST_PRACTICES = {
  d1Role: {
    id: "d1-role",
    title: "D1 is the asset INDEX",
    rule: "D1 holds search metadata (r2_key, category, grudge_uuid, content_type, sha256, pack). Never store GLB/FBX bytes in D1. Never use D1 as player bag/XP SSOT.",
    category: "storage" as const,
    surfaces: ["assets", "pipeline", "ai", "devtools"] as const,
  },
  d1Query: {
    id: "d1-query",
    title: "D1 query patterns",
    rule: "Always prepare + bind (? / ?NNN). Use batch() for multi-statement upserts (transactional). Prefer first() + LIMIT 1. Index r2_key UNIQUE, category, updated_at, kind/race/slot/status. Seed via wrangler d1 execute --remote in ≤100 statement batches.",
    category: "storage" as const,
    surfaces: ["assets", "pipeline", "ai", "coder"] as const,
  },
  d1Dbs: {
    id: "d1-databases",
    title: "D1 database map",
    rule: "grudge-assets-db → asset_registry (RTS/fleet index). grudge-objectstore → ObjectStore search. grudge-ai-hub → AI jobs. grudge-assets D1 name collides with R2 bucket name — double-check wrangler d1 vs r2 commands.",
    category: "storage" as const,
    surfaces: ["assets", "ai", "devtools"] as const,
  },
  r2Role: {
    id: "r2-role",
    title: "R2 is the binary store",
    rule: "Bucket grudge-assets served only via custom domain assets.grudge-studio.com (CDN Worker). Do not use r2.dev for production. Prefer Worker/R2 bindings or signed PUT; S3 API for bulk CLI.",
    category: "storage" as const,
    surfaces: ["assets", "pipeline", "forge", "devtools"] as const,
  },
  r2Upload: {
    id: "r2-upload",
    title: "R2 upload quality",
    rule: "Idempotent: compare local md5/ETag and skip unchanged. Multipart ≥ ~50–100 MB (parts 5 MiB–5 GiB, ≤10k parts). Set Content-Type, Cache-Control (immutable year for versioned keys), custom meta (source-hash, grudge-uuid, category).",
    category: "storage" as const,
    surfaces: ["assets", "pipeline", "ai", "devtools"] as const,
  },
  r2Keys: {
    id: "r2-keys",
    title: "Deterministic R2 keys",
    rule: "Human-readable keys: models/…, textures/…, icons/…, asset-packs/<id>/v<ver>/…. Deterministic UUID v5 from r2Key for registry. Version pins under /vN/ get max-age=31536000, immutable.",
    category: "storage" as const,
    surfaces: ["assets", "pipeline", "devtools"] as const,
  },
  r2Browse: {
    id: "r2-browse-viewer",
    title: "Dev Tool R2 browse + Asset Viewer",
    rule: "Browser: list ObjectStore/R2 prefixes; prefix filter with >query for server-side search. Click file → preview + always-on-top Asset Viewer pop-out. Actions: copy CDN path, download, send 3D to Forge.",
    category: "storage" as const,
    surfaces: ["assets", "devtools", "forge"] as const,
  },
  adminWrites: {
    id: "r2-admin-writes",
    title: "Admin-gated writes",
    rule: "R2/D1 writes require GRUDGE_ADMIN_TOKEN / X-Admin-Token or Dev Tool admin allowlist. Prefix ACL: asset-packs|manifests|shared|dev admin-only; user-uploads/<grudgeId>/ owner-only.",
    category: "storage" as const,
    surfaces: ["assets", "devtools", "pipeline"] as const,
  },
  postgresSsot: {
    id: "postgres-player-ssot",
    title: "Postgres is player SSOT",
    rule: "Railway Postgres (grudge-api-production-0d46) owns users/characters/account bag/island/wallet. Never dual-write heroes to D1 or room Railways as authority.",
    category: "storage" as const,
    surfaces: ["devtools", "deploy", "ai"] as const,
  },
  dataSharing: {
    id: "data-sharing-scopes",
    title: "Cross-game data sharing scopes",
    rule: "Account bag/GBUX shared across eras; character XP/equipment per UUID; definitions via ObjectStore; meshes via R2. Games share only through fleet REST + catalogs — never browser DATABASE_URL.",
    category: "storage" as const,
    surfaces: ["devtools", "deploy", "ai"] as const,
  },
  postgresBackup: {
    id: "postgres-backup-parallel",
    title: "Postgres backups (parallel + boring)",
    rule: "Off-request-path dumps only. Prefer parallel table logical dumps (scripts/backup-postgres.mjs) + meta time T; optional Docker pg_dump. Offsite to R2 backups/postgres/<service>/<stamp>/. Prove restore weekly. Inspired by PlanetScale base+WAL off-primary workers — grow to WAL archive when dump window risks RPO.",
    category: "storage" as const,
    surfaces: ["devtools", "deploy", "ai"] as const,
  },
  backupNoGit: {
    id: "backup-artifacts-private",
    title: "Backup artifacts never in git",
    rule: "backups/ is local/private only. No dumps in commits. DATABASE_URL only in Railway/keytar. Restore drills use staging credentials, never half-restored prod.",
    category: "storage" as const,
    surfaces: ["devtools", "deploy"] as const,
  },
  d1R2Backup: {
    id: "d1-r2-backup-recovery",
    title: "D1 / R2 recovery paths",
    rule: "D1: wrangler d1 export or re-seed from manifests. R2: versioned keys + re-upload from convert pipeline. ObjectStore JSON: git history. Room Railways are ephemeral — durable progress must live on player Postgres.",
    category: "storage" as const,
    surfaces: ["assets", "devtools", "deploy"] as const,
  },
} as const satisfies Record<string, BestPractice>;

// ─── Cloudflare Stream (video / cinema / capture) ────────────────────────────

export const MEDIA_BEST_PRACTICES = {
  streamRole: {
    id: "stream-role",
    title: "Stream for motion media",
    rule: "Use Cloudflare Stream for trailers, cinema plates, combat capture, live ops — not for GLB/FBX. Keep masters on R2; Stream holds encoded playback + adaptive bitrate.",
    category: "media" as const,
    surfaces: ["assets", "pipeline", "ai", "devtools"] as const,
  },
  streamIngest: {
    id: "stream-ingest",
    title: "Stream ingest paths",
    rule: "Prefer Stream copy-from-URL from assets.grudge-studio.com or R2 public URL after upload. TUS direct upload for large local files. Avoid Google Drive share links (rate limits).",
    category: "media" as const,
    surfaces: ["pipeline", "ai", "assets"] as const,
  },
  streamMeta: {
    id: "stream-meta",
    title: "Stream ↔ D1 linkage",
    rule: "Store Stream uid + r2_master_key + grudge_uuid in D1/ObjectStore metadata. Playback: Stream player or HLS/DASH in own player. Signed tokens for non-public cinema.",
    category: "media" as const,
    surfaces: ["assets", "pipeline", "ai"] as const,
  },
  streamLive: {
    id: "stream-live",
    title: "Live encode hygiene",
    rule: "Live: bitrate well under 12 Mbps, GOP 2–8s, prefer CBR. LL-HLS: B-frames off, GOP 2–4s, RTMP preferred over SRT when possible.",
    category: "media" as const,
    surfaces: ["pipeline", "ai"] as const,
  },
  r2VideoFallback: {
    id: "r2-video-cdn",
    title: "Short clips on R2 CDN",
    rule: "Short UI loops / SFX-adjacent mp4 may stay on R2 with correct video/mp4 MIME via CDN Worker. Long-form and adaptive → Stream.",
    category: "media" as const,
    surfaces: ["assets", "devtools"] as const,
  },
} as const satisfies Record<string, BestPractice>;

// ─── Production pipeline (convert → CDN → games) ─────────────────────────────

export const PIPELINE_BEST_PRACTICES = {
  convertFirst: {
    id: "pipeline-convert",
    title: "Bake before upload",
    rule: "Production meshes: ObjectStore/tools/grudge-convert (fbx2gltf/glb2glb) with scale, WebP textures, colliders, stripPositionTracks as required. Blender MCP is interactive cleanup only — not the ship bake.",
    category: "pipeline" as const,
    surfaces: ["pipeline", "forge", "assets", "ai"] as const,
  },
  magicBytes: {
    id: "pipeline-magic",
    title: "Magic-byte gate",
    rule: "Before wiring loaders: HEAD + first bytes. Reject HTML fake-200. glTF = glTF magic; FBX = Kaydara. Prefer size > 100KB for hero packs.",
    category: "pipeline" as const,
    surfaces: ["pipeline", "assets", "forge", "ai"] as const,
  },
  grudge6: {
    id: "pipeline-grudge6",
    title: "grudge6 races",
    rule: "Race bodies: FBX+atlas (sRGB, flipY=false) or production GLB under prod/gltf/characters/. Equipment = prefix child meshes. Anim packs: sword_shield / longbow / magic under /anims/baked. Dev Tool sanitizeMaterials + magic-byte on every load.",
    category: "pipeline" as const,
    surfaces: ["pipeline", "forge", "assets"] as const,
  },
  multipack: {
    id: "pipeline-multipack",
    title: "Multipack isolation",
    rule: "Never place whole multipack GLB as one entity. Isolate meshName/nodeName (nature, obstacles, harvest). Same for Stream timelines referencing scene plates.",
    category: "pipeline" as const,
    surfaces: ["forge", "assets", "pipeline"] as const,
  },
  forgeHandoff: {
    id: "pipeline-forge",
    title: "Send 3D to Forge",
    rule: "Dev Tool Elite: editorHandoff.ts. Scene edit → ThreeFlow ?asset= CDN URL. Deploy edit → forge.grudge-studio.com ?asset=/ ?mesh=. Never local blob for production. Scene save → R2 scenes/ + .meta.json; playtest via client/open.",
    category: "pipeline" as const,
    surfaces: ["forge", "pipeline", "devtools", "assets"] as const,
  },
  workerJobs: {
    id: "pipeline-jobs",
    title: "ConversionPipeline Worker",
    rule: "CF job Worker owns queue/dedup/status in D1 — bake stays on CLI/agent/desktop. AI Worker enqueues jobs; does not run heavy glTF-Transform on the edge request path.",
    category: "pipeline" as const,
    surfaces: ["pipeline", "ai", "coder"] as const,
  },
} as const satisfies Record<string, BestPractice>;

// ─── Product surfaces + DNS (admin stack) ────────────────────────────────────

export const SURFACE_BEST_PRACTICES = {
  devToolHub: {
    id: "surface-devtools",
    title: "Dev Tool = Studio hub",
    rule: "grudge-dev-tool is primary admin surface: Studio DB, R2 browse, Asset Viewer, Forge workbench, Agent Make & Deploy, Coder handoff — not a secondary utility.",
    category: "surfaces" as const,
    surfaces: ["devtools", "ai"] as const,
  },
  dnsMap: {
    id: "surface-dns",
    title: "Studio DNS map (update targets)",
    rule: "assets=R2 CDN · objectstore=catalogs/search · ai=Legion hub · forge=R3F deploy editor · threeflow=Warlords scene editor · pipeline=grudge-pipeline.vercel.app · coder=coder.grudge-studio.com · id=auth · client=ONE TRUTH · obs=telemetry · water/open/character/grudox=games.",
    category: "surfaces" as const,
    surfaces: ["devtools", "deploy", "coder", "ai"] as const,
  },
  coder: {
    id: "surface-coder",
    title: "Coder IDE",
    rule: "coder.grudge-studio.com (Pages) + api.vibe / vibe-backend Workers. Fleet games still follow CDN asset rules; Coder skills teach patterns only. Handoff: ?workspace=&from=grudge-dev-tool.",
    category: "surfaces" as const,
    surfaces: ["coder", "devtools", "ai"] as const,
  },
  forge: {
    id: "surface-forge",
    title: "Forge editor (same source as DNS)",
    rule: "Dev Tool Forge tab embeds https://forge.grudge-studio.com — not a fork. R3F+Rapier+.gfscene deploy. Warlords scene work = ThreeFlow (threeflow.vercel.app ?asset=). Local tools = convert/pop-out only. Production bake = grudge-convert → R2. Play test → Preview.",
    category: "surfaces" as const,
    surfaces: ["forge", "pipeline", "devtools", "preview"] as const,
  },
  preview: {
    id: "surface-preview",
    title: "Preview play mode",
    rule: "Preview tab loads production clients for admin playtests after Forge. Deep-link sceneId/glb. Targets: open.grudge-studio.com, client, water, grudox, multiverse (grudge-multiverse.vercel.app), warlords — never orphaned Vercel hosts. Multiverse multiplayer is its own Railway /api/mv — not Carrier.",
    category: "surfaces" as const,
    surfaces: ["preview", "forge", "devtools"] as const,
  },
  multiverse: {
    id: "surface-multiverse",
    title: "Grudge Multiverse (dedicated Railway)",
    rule: "SPA grudge-multiverse.vercel.app; room server grudge-multiverse-room-production.up.railway.app with WS /api/mv only. Map Bermuda from R2 CDN. grudge6 RTS Toon + Main Panel. Never route Multiverse through gameopen Carrier or metaverse.grudge-studio.com. Each multiplayer game gets its own Railway when it needs rooms.",
    category: "surfaces" as const,
    surfaces: ["preview", "deploy", "devtools"] as const,
  },
  skeletonStore: {
    id: "surface-skeleton-store",
    title: "Skeleton · Store · BlenderKit · UUID",
    rule: "Skeleton: 25-bone place → T-pose → retarget → convert → CDN. Store/catalogs: ObjectStore + info.grudge-studio.com JSON. BlenderKit is ingest only (daemon → convert), not mesh SSOT. UUID: shared/grudgeUUID.ts only.",
    category: "surfaces" as const,
    surfaces: ["devtools", "assets", "pipeline"] as const,
  },
  pluginAttach: {
    id: "surface-plugin",
    title: "Plugin attach (VS Code / standalone / viewer)",
    rule: "Grudge Dev Tool hosts the plugin kernel at 127.0.0.1:17380. VS Code (GrudachainCode packages/vscode-extension), standalone GET /, CLI `grudge-dev plugin`, and elite viewer all attach here. Token in %APPDATA%/grudge-dev-tool/plugin-token. Legion = brain, Forge = hands, Coder = IDE — do not merge names.",
    category: "surfaces" as const,
    surfaces: ["devtools", "ai", "coder", "forge"] as const,
  },
  docsSameSource: {
    id: "surface-docs",
    title: "Docs same source as Pages",
    rule: "docs/ Markdown is SSOT for GitHub Pages (pages.yml Jekyll) and in-app Docs catalog. Bump version stamps with releases. Link production-deployment + admin-architecture for fleet wiring.",
    category: "surfaces" as const,
    surfaces: ["devtools", "deploy"] as const,
  },
  workersConfig: {
    id: "surface-workers-config",
    title: "Workers production config",
    rule: "compatibility_date ≥ current quarter; nodejs_compat on; wrangler types / worker-configuration.d.ts for Env; [observability] enabled; secrets via wrangler secret put / keytar only; service bindings Worker↔Worker; Queues/Workflows for async convert/AI; no module-level request state; stream large responses; ctx.waitUntil for post-response telemetry. Audit: node scripts/audit-workers-config.mjs. Legion SSOT = grudge-ai-hub (ai.grudge-studio.com) — do not rebind with grudge-ai-gateway.",
    category: "surfaces" as const,
    surfaces: ["coder", "ai", "deploy"] as const,
  },
  cors: {
    id: "surface-cors",
    title: "CORS allowlist",
    rule: "Keep *.grudge-studio.com, grudgewarlords.com, *.vercel.app, *.puter.site, localhost:5173/3000/5000 aligned across Workers and Railway. New subdomains must be added when shipping.",
    category: "surfaces" as const,
    surfaces: ["deploy", "devtools", "coder"] as const,
  },
} as const satisfies Record<string, BestPractice>;

// ─── Aggregates ──────────────────────────────────────────────────────────────

export type BestPracticeId =
  | keyof typeof FLEET_BEST_PRACTICES
  | keyof typeof AI_BEST_PRACTICES
  | keyof typeof STORAGE_BEST_PRACTICES
  | keyof typeof MEDIA_BEST_PRACTICES
  | keyof typeof PIPELINE_BEST_PRACTICES
  | keyof typeof SURFACE_BEST_PRACTICES;

/** Backward-compatible list used by existing UI (fleet-only was original). */
export const FLEET_BEST_PRACTICE_LIST: BestPractice[] = Object.values(
  FLEET_BEST_PRACTICES,
);

/** Full production catalog for agents + admin Access panel. */
export const ALL_BEST_PRACTICES: BestPractice[] = [
  ...Object.values(FLEET_BEST_PRACTICES),
  ...Object.values(AI_BEST_PRACTICES),
  ...Object.values(STORAGE_BEST_PRACTICES),
  ...Object.values(MEDIA_BEST_PRACTICES),
  ...Object.values(PIPELINE_BEST_PRACTICES),
  ...Object.values(SURFACE_BEST_PRACTICES),
];

export function getBestPractices(opts?: {
  category?: BestPracticeCategory | BestPracticeCategory[];
  surface?: string;
  includeFleetOnly?: boolean;
}): BestPractice[] {
  const cats = opts?.category
    ? Array.isArray(opts.category)
      ? opts.category
      : [opts.category]
    : null;
  const base = opts?.includeFleetOnly ? FLEET_BEST_PRACTICE_LIST : ALL_BEST_PRACTICES;
  return base.filter((p) => {
    if (cats && !cats.includes(p.category)) return false;
    if (opts?.surface && p.surfaces && !p.surfaces.includes(opts.surface)) return false;
    return true;
  });
}

/**
 * System prompt fragment for local + hub agents.
 * Pass surface to bias (e.g. "assets", "forge", "ai", "pipeline").
 */
export function agentBestPracticesPrompt(surface?: string): string {
  const list = surface
    ? getBestPractices({ surface })
    : getBestPractices({
        category: ["fleet", "ai", "storage", "media", "pipeline", "surfaces"],
      });
  // Cap length for context: prioritize fleet + storage + ai + pipeline when unbounded
  const prioritized =
    surface != null
      ? list
      : [
          ...getBestPractices({ category: "fleet" }),
          ...getBestPractices({ category: "storage" }),
          ...getBestPractices({ category: "ai" }),
          ...getBestPractices({ category: "pipeline" }),
          ...getBestPractices({ category: "media" }),
          ...getBestPractices({ category: "surfaces" }),
        ];
  const unique = new Map(prioritized.map((p) => [p.id, p]));
  const lines = [...unique.values()].map((p) => `- [${p.category}] ${p.title}: ${p.rule}`);
  return [
    "Follow Grudge Studio production best practices (AI workers, D1/R2/Stream, fleet assets):",
    ...lines,
    "",
    "Output quality bar: production-ready convert, magic-byte verified CDN paths, D1-indexed keys, no invented meshes, no new player APIs on api.grudge-studio.com (legacy index only).",
  ].join("\n");
}

/** Compact prompt for Make & Deploy presets (token-efficient). */
export function agentBestPracticesCompact(): string {
  return [
    "Follow Grudge Studio fleet best practices:",
    ...FLEET_BEST_PRACTICE_LIST.map((p) => `- ${p.title}: ${p.rule}`),
    "- AI: Legion=ai.grudge-studio.com; Workers AI via binding/gateway; cache deterministic only.",
    "- D1=asset index (prepare/bind/batch); R2=binaries at assets.grudge-studio.com; Stream=long video.",
    "- Convert before upload; magic-byte verify; Elite → ThreeFlow/Forge via CDN ?asset=.",
    "- Scene editor = threeflow.vercel.app. Forge tab = forge.grudge-studio.com (R3F deploy). Preview = play clients. Coder = coder.grudge-studio.com.",
    "- Plugin: dest-tool hosts 127.0.0.1:17380 for VS Code / standalone / viewer / agentic. Legion=brain, Forge=hands, Coder=IDE.",
    "- Admin APIs: client · id · Railway · objectstore · info.* · assets · open · grudox · multiverse · engine portal.",
    "- Multiverse: SPA grudge-multiverse.vercel.app + Railway /api/mv (own service, not Carrier).",
    "- DB: player SSOT = Railway Postgres; dump via npm run backup:postgres (parallel tables); never commit backups/; share bag via account APIs not D1.",
  ].join("\n");
}

/** Domains allowed for play / forge remote open (access allowlist UI) */
export const PLAY_ACCESS_ORIGINS = [
  "https://open.grudge-studio.com",
  "https://character.grudge-studio.com",
  "https://client.grudge-studio.com",
  "https://water.grudge-studio.com",
  "https://grudgewarlords.com",
  "https://grudox.grudge-studio.com",
  "https://grudge-multiverse.vercel.app",
  "https://grudge-multiverse-room-production.up.railway.app",
  "https://forge.grudge-studio.com",
  "https://threeflow.vercel.app",
  "https://grudge-pipeline.vercel.app",
  "https://studio.grudge-studio.com",
  "https://grudges.grudge-studio.com",
  "https://drive.grudge-studio.com",
  "https://dcq.grudge-studio.com",
  "https://metaverse.grudge-studio.com",
  "https://id.grudge-studio.com",
  "https://ai.grudge-studio.com",
  "https://assets.grudge-studio.com",
  "https://objectstore.grudge-studio.com",
  "https://coder.grudge-studio.com",
  "https://grudachain.grudge-studio.com",
  "https://obs.grudge-studio.com",
  "https://info.grudge-studio.com",
  "https://wallet.grudge-studio.com",
] as const;

/**
 * Admin DNS / product surface registry — keep aligned with grudge-fleet skill
 * and FLEET_URLS. Used by Studio Hub + agent context.
 */
export const STUDIO_SURFACE_DNS = [
  { id: "client", host: "client.grudge-studio.com", role: "ONE TRUTH API rewrites + Warlords client" },
  { id: "id", host: "id.grudge-studio.com", role: "Grudge ID SSO" },
  { id: "assets", host: "assets.grudge-studio.com", role: "R2 CDN binaries" },
  { id: "objectstore", host: "objectstore.grudge-studio.com", role: "JSON catalogs + search Worker" },
  { id: "ai", host: "ai.grudge-studio.com", role: "Legion AI Gateway hub" },
  { id: "puter-space", host: "ai.grudge-studio.com/puter-space", role: "Player account Puter FS + site deploy (not bag SSOT)" },
  { id: "forge", host: "forge.grudge-studio.com", role: "R3F + Rapier + .gfscene deploy editor" },
  { id: "threeflow", host: "threeflow.vercel.app", role: "Warlords scene editor (Elite ?asset=)" },
  { id: "pipeline", host: "grudge-pipeline.vercel.app", role: "FBX/GLB ingest → bake handoff" },
  { id: "coder", host: "coder.grudge-studio.com", role: "Vibe IDE + AI workers" },
  { id: "open", host: "open.grudge-studio.com", role: "Open launcher" },
  { id: "character", host: "character.grudge-studio.com", role: "Foundry create + 4-slot" },
  { id: "water", host: "water.grudge-studio.com", role: "Home island production" },
  { id: "grudox", host: "grudox.grudge-studio.com", role: "GRUDOX + Carrier edge" },
  {
    id: "multiverse",
    host: "grudge-multiverse.vercel.app",
    role: "Multiverse SPA (Bermuda + grudge6) — not Metaverse",
  },
  {
    id: "multiverse-room",
    host: "grudge-multiverse-room-production.up.railway.app",
    role: "Multiverse rooms WS /api/mv only",
  },
  {
    id: "obs",
    host: "obs.grudge-studio.com",
    role: "Observatory — DNS often missing; optional until CNAME live",
  },
  { id: "info", host: "info.grudge-studio.com", role: "Live definition catalogs" },
  { id: "wallet", host: "wallet.grudge-studio.com", role: "Wallet site Worker" },
  {
    id: "deprecated-api",
    host: "api.grudge-studio.com",
    role: "LEGACY live asset index — do not use for new player APIs; prefer ObjectStore + assets CDN",
  },
] as const;
