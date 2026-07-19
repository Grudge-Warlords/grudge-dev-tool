/**
 * Shared Legion contracts — agent roster, providers, run results.
 * Imported by both main (dispatch + registry) and renderer (Phase 5 dashboard).
 */

export type ProviderId =
  | "groq"
  | "together"
  | "workers-ai"
  | "puter"
  | "openrouter"
  | "fireworks";

export type AgentTier = "core" | "silent";

export type AgentId =
  // core
  | "legion-admin"
  | "scribe"
  | "forgewright"
  | "geomancer"
  | "courier"
  // silent
  | "quartermaster"
  | "cartographer"
  | "heraldsman"
  | "watchman"
  | "bursar"
  | "loremaster"
  | "envoy"
  | "sentinel";

export type ToolId =
  | "readFile"
  | "writeFile"
  | "runTypecheck"
  | "inspectGLB"
  | "meshOptimize"
  | "queryD1"
  | "r2List"
  | "r2Head"
  | "httpFetch"
  | "runIngestion"
  | "assetMeta"
  | "obsAiStats"
  | "obsQuery"
  | "getFleetStatus"
  | "healthCheck"
  | "verifyCreds"
  | "grepCodebase"
  | "chromaQuery"
  | "puterChat"
  | "puterKv"
  | "dispatch"
  | "schedule";

export interface ProviderRef {
  provider: ProviderId;
  /** Model id as the provider expects (env-overridable per agent). */
  model: string;
}

export interface AgentBudget {
  maxTokensPerRun: number;
  maxRunsPerHour: number;
}

export interface SilentTemplate {
  trigger:
    | { kind: "cron"; expr: string }
    | { kind: "event"; name: string }
    | { kind: "delegation" };
  /** Optional precondition gate. Receives the trigger context. */
  precondition?: string;
  /** Pre-baked system + user prompt. `{{var}}` placeholders filled from ctx. */
  prompt: string;
  /** Where the agent's textual output should go after the run. */
  outputHandler: "writeFile" | "obsEvent" | "ipcEmit" | "none";
}

export interface AgentDef {
  id: AgentId;
  name: string;
  tier: AgentTier;
  /** One-line role description for the dashboard. */
  role: string;
  /** Markdown-safe persona / system prompt fragment. */
  persona: string;
  primary: ProviderRef;
  fallback?: ProviderRef;
  tools: ToolId[];
  budget: AgentBudget;
  /** Required for tier="silent"; ignored for tier="core". */
  template?: SilentTemplate;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface RunRequest {
  agentId: AgentId;
  messages: ChatMessage[];
  /** Free-form context the agent's prompt can reference. */
  context?: Record<string, unknown>;
  /** Overrides the agent's default budget for this single call. */
  budgetOverride?: Partial<AgentBudget>;
}

export interface RunResult {
  agentId: AgentId;
  provider: ProviderId;
  model: string;
  text: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  /** If the primary provider failed and fallback succeeded. */
  fellBackFrom?: ProviderId;
  /** Set when run was rejected by the budget guard. */
  rejected?: { reason: "rate" | "tokens" | "no-credentials"; detail: string };
}
