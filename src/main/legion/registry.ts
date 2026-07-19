import { obsPushAiEvent } from "../cf/observatory";
import log from "../logger";
import {
  providerChat,
  providerHasCredentials,
  MissingProviderCredentialError,
} from "./providers";
import { ALL_AGENTS } from "./roster";
import type {
  AgentDef,
  AgentId,
  ChatMessage,
  ProviderId,
  RunRequest,
  RunResult,
} from "../../shared/legion";

/**
 * Legion registry — agent lookup, budget guard, and dispatch with fallback.
 *
 * Phase 1 surface only: in-process. No IPC, no cron, no UI. Phase 2 adds
 * ipcMain.handle wrappers + preload bridge; Phase 4 adds the scheduler that
 * fires Silent templates.
 */

const BY_ID = new Map<AgentId, AgentDef>(ALL_AGENTS.map(a => [a.id, a]));

// Rolling window counters for the per-hour budget guard.
const HOUR_MS = 60 * 60 * 1000;
const runWindow = new Map<AgentId, number[]>();

function recordRun(id: AgentId): void {
  const now = Date.now();
  const arr = (runWindow.get(id) ?? []).filter(t => now - t < HOUR_MS);
  arr.push(now);
  runWindow.set(id, arr);
}

function runsInLastHour(id: AgentId): number {
  const now = Date.now();
  const arr = (runWindow.get(id) ?? []).filter(t => now - t < HOUR_MS);
  runWindow.set(id, arr);
  return arr.length;
}

export function getAgent(id: AgentId): AgentDef {
  const agent = BY_ID.get(id);
  if (!agent) throw new Error(`Unknown Legion agent: ${id}`);
  return agent;
}

export function listAgents(tier?: "core" | "silent"): AgentDef[] {
  return tier ? ALL_AGENTS.filter(a => a.tier === tier) : ALL_AGENTS;
}

/** Probe credential coverage for the entire roster. */
export async function getRosterStatus(): Promise<Array<{
  id: AgentId;
  name: string;
  tier: "core" | "silent";
  primaryReady: boolean;
  fallbackReady: boolean | null;
}>> {
  return Promise.all(ALL_AGENTS.map(async (a) => ({
    id: a.id,
    name: a.name,
    tier: a.tier,
    primaryReady: await providerHasCredentials(a.primary.provider),
    fallbackReady: a.fallback ? await providerHasCredentials(a.fallback.provider) : null,
  })));
}

function buildMessages(agent: AgentDef, req: RunRequest): ChatMessage[] {
  // Inject the persona as a system message unless the caller already supplied one.
  const hasSystem = req.messages.some(m => m.role === "system");
  if (hasSystem) return req.messages;
  return [{ role: "system", content: agent.persona }, ...req.messages];
}

async function tryProvider(
  agent: AgentDef,
  provider: ProviderId,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  return providerChat(provider, { model, messages, maxTokens });
}

/** Dispatch a single chat run for an agent, with provider fallback + telemetry. */
export async function runAgent(req: RunRequest): Promise<RunResult> {
  const agent = getAgent(req.agentId);
  const budget = { ...agent.budget, ...req.budgetOverride };

  if (runsInLastHour(agent.id) >= budget.maxRunsPerHour) {
    return {
      agentId: agent.id,
      provider: agent.primary.provider,
      model: agent.primary.model,
      text: "",
      latencyMs: 0,
      rejected: { reason: "rate", detail: `Exceeded ${budget.maxRunsPerHour} runs/hour` },
    };
  }

  const messages = buildMessages(agent, req);
  const start = Date.now();
  let fellBackFrom: ProviderId | undefined;
  let lastErr: unknown;

  for (const route of [agent.primary, ...(agent.fallback ? [agent.fallback] : [])]) {
    try {
      const out = await tryProvider(agent, route.provider, route.model, messages, budget.maxTokensPerRun);
      const latencyMs = Date.now() - start;
      recordRun(agent.id);
      obsPushAiEvent({
        provider: route.provider, model: route.model,
        input_tokens: out.inputTokens, output_tokens: out.outputTokens,
        latency_ms: latencyMs, status: "ok",
      }).catch(() => {});
      return {
        agentId: agent.id,
        provider: route.provider,
        model: route.model,
        text: out.text,
        latencyMs,
        inputTokens: out.inputTokens,
        outputTokens: out.outputTokens,
        ...(fellBackFrom ? { fellBackFrom } : {}),
      };
    } catch (err) {
      lastErr = err;
      log.warn(`[legion] ${agent.id} via ${route.provider}/${route.model} failed: ${(err as Error).message}`);
      if (!fellBackFrom) fellBackFrom = route.provider;
      if (err instanceof MissingProviderCredentialError) continue;
    }
  }

  const latencyMs = Date.now() - start;
  obsPushAiEvent({
    provider: agent.primary.provider, model: agent.primary.model,
    latency_ms: latencyMs, status: "error",
  }).catch(() => {});

  if (lastErr instanceof MissingProviderCredentialError) {
    return {
      agentId: agent.id,
      provider: agent.primary.provider,
      model: agent.primary.model,
      text: "",
      latencyMs,
      rejected: { reason: "no-credentials", detail: (lastErr as Error).message },
    };
  }
  throw lastErr ?? new Error(`Legion dispatch failed for ${agent.id}`);
}
