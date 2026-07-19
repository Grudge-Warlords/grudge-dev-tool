import type { AgentDef } from "../../shared/legion";

/**
 * Default Legion roster — 5 core + 8 silent agents.
 *
 * All models are env-overridable so a new model SKU can be tested without a
 * rebuild. Convention: LEGION_<AGENT_ID>_MODEL (uppercase, hyphens → underscores).
 */

function envModel(agentId: string, fallback: string): string {
  const key = `LEGION_${agentId.toUpperCase().replace(/-/g, "_")}_MODEL`;
  return process.env[key] ?? fallback;
}

// ─── Core (5) ────────────────────────────────────────────────────────────────

export const CORE_AGENTS: AgentDef[] = [
  {
    id: "legion-admin",
    name: "Legion Admin",
    tier: "core",
    role: "Supervisor and router — the only agent the user types to directly.",
    persona:
      "You are the Legion Admin for Grudge Studio Forge. Route requests to the right specialist (Scribe, Forgewright, Geomancer, Courier) or delegate to a Silent agent. Keep responses concise and action-oriented.",
    primary:  { provider: "groq",     model: envModel("legion-admin", "llama-3.3-70b-versatile") },
    fallback: { provider: "together", model: envModel("legion-admin-fb", "meta-llama/Llama-3.3-70B-Instruct-Turbo") },
    tools: ["dispatch", "grepCodebase", "getFleetStatus", "obsAiStats"],
    budget: { maxTokensPerRun: 2048, maxRunsPerHour: 240 },
  },
  {
    id: "scribe",
    name: "Scribe",
    tier: "core",
    role: "JS/TS code edits — refactors, type fixes, IPC additions.",
    persona:
      "You are the Scribe. You write idiomatic TypeScript matching the Grudge Forge codebase style. Match existing patterns. Never invent APIs.",
    primary:  { provider: "together", model: envModel("scribe", "deepseek-ai/DeepSeek-V3") },
    fallback: { provider: "groq",     model: envModel("scribe-fb", "llama-3.3-70b-versatile") },
    tools: ["readFile", "writeFile", "grepCodebase", "runTypecheck"],
    budget: { maxTokensPerRun: 4096, maxRunsPerHour: 120 },
  },
  {
    id: "forgewright",
    name: "Forgewright",
    tier: "core",
    role: "Three.js / R3F / GLSL — 3D scenes, shaders, postprocessing.",
    persona:
      "You are the Forgewright. You produce production-grade Three.js / R3F / GLSL code. Always specify import paths and version assumptions.",
    primary:  { provider: "together", model: envModel("forgewright", "deepseek-ai/DeepSeek-V3") },
    fallback: { provider: "groq",     model: envModel("forgewright-fb", "llama-3.3-70b-versatile") },
    tools: ["readFile", "writeFile", "inspectGLB", "meshOptimize"],
    budget: { maxTokensPerRun: 4096, maxRunsPerHour: 60 },
  },
  {
    id: "geomancer",
    name: "Geomancer",
    tier: "core",
    role: "Math, CSS, Tailwind, layout — geometry, animations, responsive design.",
    persona:
      "You are the Geomancer. You handle math derivations, CSS, Tailwind v3 classes, and responsive layout. Be concise and show the formula before the code.",
    primary:  { provider: "groq",     model: envModel("geomancer", "llama-3.3-70b-versatile") },
    fallback: { provider: "together", model: envModel("geomancer-fb", "Qwen/Qwen2.5-72B-Instruct-Turbo") },
    tools: ["readFile", "writeFile"],
    budget: { maxTokensPerRun: 2048, maxRunsPerHour: 120 },
  },
  {
    id: "courier",
    name: "Courier",
    tier: "core",
    role: "Network, API, D1, IPC wiring — endpoints, contracts, requests.",
    persona:
      "You are the Courier. You wire HTTP endpoints, D1 queries, Cloudflare Workers, and Electron IPC. Always include error handling and timeouts.",
    primary:  { provider: "together", model: envModel("courier", "deepseek-ai/DeepSeek-V3") },
    fallback: { provider: "groq",     model: envModel("courier-fb", "llama-3.3-70b-versatile") },
    tools: ["readFile", "writeFile", "httpFetch", "queryD1", "r2List", "r2Head"],
    budget: { maxTokensPerRun: 4096, maxRunsPerHour: 90 },
  },
];

// ─── Silent (8) — template-driven, hidden from chat ──────────────────────────

export const SILENT_AGENTS: AgentDef[] = [
  {
    id: "quartermaster",
    name: "Quartermaster",
    tier: "silent",
    role: "Validates ingested asset packs against the R2 manifest schema.",
    persona: "You verify Grudge asset manifests for correctness and completeness.",
    primary:  { provider: "workers-ai", model: envModel("quartermaster", "@cf/meta/llama-3.1-8b-instruct") },
    tools: ["r2List", "r2Head", "assetMeta", "readFile"],
    budget: { maxTokensPerRun: 1024, maxRunsPerHour: 12 },
    template: {
      trigger: { kind: "event", name: "ingestion:complete" },
      prompt: "Audit manifest at {{manifestPath}} for missing fields, UUID format, and SLOT_BY_FAMILY consistency. Output JSON: { ok: boolean, issues: string[] }.",
      outputHandler: "obsEvent",
    },
  },
  {
    id: "cartographer",
    name: "Cartographer",
    tier: "silent",
    role: "Nightly UUID consistency audit across D1 + R2.",
    persona: "You cross-reference Grudge UUIDs between D1 player_characters and R2 paths.",
    primary: { provider: "workers-ai", model: envModel("cartographer", "@cf/meta/llama-3.1-8b-instruct") },
    tools: ["queryD1", "r2List", "obsQuery"],
    budget: { maxTokensPerRun: 1024, maxRunsPerHour: 2 },
    template: {
      trigger: { kind: "cron", expr: "0 4 * * *" },
      prompt: "Compare D1 character UUIDs to R2 asset UUIDs. Report orphans and dangling references.",
      outputHandler: "obsEvent",
    },
  },
  {
    id: "heraldsman",
    name: "Heraldsman",
    tier: "silent",
    role: "Drafts release notes when a version bump or release event fires.",
    persona: "You write concise, user-facing CHANGELOG entries for Grudge Studio Forge releases.",
    primary:  { provider: "groq",     model: envModel("heraldsman", "llama-3.3-70b-versatile") },
    fallback: { provider: "together", model: envModel("heraldsman-fb", "meta-llama/Llama-3.3-70B-Instruct-Turbo") },
    tools: ["readFile", "writeFile", "grepCodebase"],
    budget: { maxTokensPerRun: 2048, maxRunsPerHour: 6 },
    template: {
      trigger: { kind: "event", name: "release:prepare" },
      prompt: "Given the git log diff at {{logRange}}, draft a CHANGELOG.md entry following Keep-a-Changelog format.",
      outputHandler: "writeFile",
    },
  },
  {
    id: "watchman",
    name: "Watchman",
    tier: "silent",
    role: "Periodic fleet health snapshot — pings every domain and worker.",
    persona: "You summarise fleet health into a single status line per service.",
    primary: { provider: "workers-ai", model: envModel("watchman", "@cf/meta/llama-3.1-8b-instruct") },
    tools: ["healthCheck", "getFleetStatus"],
    budget: { maxTokensPerRun: 512, maxRunsPerHour: 8 },
    template: {
      trigger: { kind: "cron", expr: "*/15 * * * *" },
      prompt: "Given fleet status JSON {{status}}, return a one-line summary per failing service. Empty string if all green.",
      outputHandler: "obsEvent",
    },
  },
  {
    id: "bursar",
    name: "Bursar",
    tier: "silent",
    role: "AI cost guardian — alerts when hourly spend crosses a ceiling.",
    persona: "You track AI provider spending and raise alerts when projected daily cost exceeds budget.",
    primary: { provider: "workers-ai", model: envModel("bursar", "@cf/meta/llama-3.1-8b-instruct") },
    tools: ["obsAiStats", "obsQuery"],
    budget: { maxTokensPerRun: 512, maxRunsPerHour: 4 },
    template: {
      trigger: { kind: "cron", expr: "0 * * * *" },
      precondition: "hourly_cost_usd > LEGION_BURSAR_CEILING",
      prompt: "Given hourly AI stats {{stats}} and ceiling {{ceiling}}, output a JSON alert: { breach: boolean, projected_daily: number, top_offender: string }.",
      outputHandler: "obsEvent",
    },
  },
  {
    id: "loremaster",
    name: "Loremaster",
    tier: "silent",
    role: "Codebase RAG lookup — answers 'where is X?' for other agents.",
    persona: "You return file paths and line ranges for symbols, types, and concepts in the Grudge Forge codebase.",
    primary:  { provider: "groq",     model: envModel("loremaster", "llama-3.1-8b-instant") },
    fallback: { provider: "together", model: envModel("loremaster-fb", "Qwen/Qwen2.5-7B-Instruct-Turbo") },
    tools: ["grepCodebase", "chromaQuery", "readFile"],
    budget: { maxTokensPerRun: 1024, maxRunsPerHour: 60 },
    template: {
      trigger: { kind: "delegation" },
      prompt: "Find references to {{symbol}} in the codebase. Return JSON: [{ path, line, snippet }].",
      outputHandler: "ipcEmit",
    },
  },
  {
    id: "envoy",
    name: "Envoy",
    tier: "silent",
    role: "Renderer bridge — runs prompts via puter.ai.chat when Puter context is required.",
    persona: "You proxy chat completions through the renderer-side Puter SDK.",
    primary: { provider: "puter", model: envModel("envoy", "claude-sonnet-4-20250514") },
    fallback: { provider: "groq", model: envModel("envoy-fb", "llama-3.3-70b-versatile") },
    tools: ["puterChat", "puterKv"],
    budget: { maxTokensPerRun: 2048, maxRunsPerHour: 60 },
    template: {
      trigger: { kind: "delegation" },
      prompt: "Forward {{messages}} to puter.ai.chat with model {{model}}. Return the assistant response verbatim.",
      outputHandler: "ipcEmit",
    },
  },
  {
    id: "sentinel",
    name: "Sentinel",
    tier: "silent",
    role: "Secret store audit — verifies keytar entries and flags rotations.",
    persona: "You audit the dev tool's credential vault for missing, stale, or oversized secrets.",
    primary: { provider: "workers-ai", model: envModel("sentinel", "@cf/meta/llama-3.1-8b-instruct") },
    tools: ["verifyCreds"],
    budget: { maxTokensPerRun: 512, maxRunsPerHour: 2 },
    template: {
      trigger: { kind: "cron", expr: "0 6 * * 0" },
      prompt: "Given verifyCreds output {{report}}, list missing or stale keytar accounts as JSON: { missing: string[], stale: string[] }.",
      outputHandler: "obsEvent",
    },
  },
];

export const ALL_AGENTS: AgentDef[] = [...CORE_AGENTS, ...SILENT_AGENTS];
