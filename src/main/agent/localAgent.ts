/**
 * In-app Agent AI — runs entirely inside Grudge Studio (main process).
 * Does NOT open a browser. Uses Ollama → Workers AI / Legion via aiChat.
 */

import { randomUUID } from "node:crypto";
import { aiChat } from "../fleet/aiWorkerManager";
import * as ollama from "../ollama";
import log from "../logger";

export interface LocalAgentStep {
  step: number;
  action: string;
  detail?: string;
}

export interface LocalAgentRunResult {
  runId: string;
  response: string;
  steps: LocalAgentStep[];
  source: string;
  provider?: string;
  model?: string;
}

export interface LocalOrchestratorStep {
  step: number;
  worker: string;
  action: string;
  detail: string;
  command?: string;
  auto?: boolean;
}

export interface LocalOrchestratorResult {
  ok: boolean;
  runId: string;
  status: string;
  workers: Array<{ id: string; label: string; caps: string[] }>;
  plan: LocalOrchestratorStep[];
  summary: string;
  executeLocally: LocalOrchestratorStep[];
  message: string;
  source: string;
}

const AGENT_SYSTEM = `You are GRUDA, the in-app Grudge Studio Agent AI (desktop shell).
You help ship games, assets, Forge scenes, R2 packs, and fleet ops.
Be concrete and actionable. Prefer ONE TRUTH:
- client.grudge-studio.com
- assets.grudge-studio.com
- Railway game-data
- Forge tools in this desktop app (not external browser).
When listing steps, use short numbered actions.`;

const ORCH_SYSTEM = `You are the Grudge Studio local orchestrator inside the desktop app.
Return ONLY JSON (no markdown):
{
  "summary": "one line",
  "plan": [
    {
      "step": 1,
      "worker": "local|forge|npm|fleet|ollama",
      "action": "short verb",
      "detail": "what to do",
      "command": "optional shell e.g. npm run build",
      "auto": true
    }
  ],
  "message": "user-facing paragraph"
}
Rules:
- 3–8 steps max
- Prefer local desktop tools (npm, forge, terminal) over opening browsers
- auto=true only for safe local commands (npm run *, grudge-dev doctor)
- worker ids: local, forge, npm, fleet, ollama, upload`;

function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* continue */
  }
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("Orchestrator response was not JSON");
}

/** Chat with local stack: ensure Ollama, then aiChat routing. */
export async function localAgentChat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<{ text: string; source: string; provider?: string; model?: string }> {
  // Warm Ollama if possible (non-fatal)
  try {
    const h = await ollama.ollamaHealth();
    if (!h.ok) {
      await ollama.ensureRunning({ reason: "local-agent", agentic: true }).catch(() => null);
    }
  } catch {
    /* continue to cloud */
  }

  try {
    const res = await aiChat({
      messages,
      temperature: 0.35,
      max_tokens: 1200,
      track: true,
    });
    return {
      text: res.text,
      source: `in-app:${res.provider}`,
      provider: res.provider,
      model: res.model,
    };
  } catch (e1: unknown) {
    // Direct ollama as last resort
    try {
      const r = await ollama.ollamaChat({ messages });
      return {
        text: r.message?.content ?? "",
        source: "in-app:ollama-direct",
        provider: "ollama",
      };
    } catch (e2: unknown) {
      const m1 = e1 instanceof Error ? e1.message : String(e1);
      const m2 = e2 instanceof Error ? e2.message : String(e2);
      throw new Error(`In-app agent AI unavailable. Ollama/Workers/Legion all failed.\n${m1}\n${m2}`);
    }
  }
}

export async function runLocalAgent(opts: {
  task: string;
  projectId?: string;
  role?: string;
}): Promise<LocalAgentRunResult> {
  const runId = randomUUID();
  const steps: LocalAgentStep[] = [
    { step: 1, action: "accept_task", detail: opts.task.slice(0, 200) },
    { step: 2, action: "route_llm", detail: "Ollama → Workers AI → Legion (in-process)" },
  ];

  log.info(`[localAgent] run ${runId.slice(0, 8)} task=${opts.task.slice(0, 80)}`);

  const chat = await localAgentChat([
    { role: "system", content: AGENT_SYSTEM },
    {
      role: "user",
      content: [
        opts.projectId ? `Project id: ${opts.projectId}` : null,
        `Role: ${opts.role ?? "dev"}`,
        "",
        opts.task,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ]);

  steps.push({
    step: 3,
    action: "complete",
    detail: `via ${chat.source}${chat.model ? ` · ${chat.model}` : ""}`,
  });

  return {
    runId,
    response: chat.text || "(empty model response)",
    steps,
    source: chat.source,
    provider: chat.provider,
    model: chat.model,
  };
}

export async function runLocalOrchestrator(opts: {
  task: string;
  projectId?: string;
}): Promise<LocalOrchestratorResult> {
  const runId = randomUUID();
  const workers = [
    { id: "local", label: "Desktop local", caps: ["terminal", "npm", "files"] },
    { id: "forge", label: "Forge 3D", caps: ["scene", "weld", "export"] },
    { id: "npm", label: "npm scripts", caps: ["build", "dev"] },
    { id: "fleet", label: "ONE TRUTH fleet", caps: ["health", "r2", "objectstore"] },
    { id: "ollama", label: "Local Ollama", caps: ["chat", "agentic"] },
    { id: "upload", label: "Upload pipeline", caps: ["ingest", "r2"] },
  ];

  let plan: LocalOrchestratorStep[] = [];
  let summary = "";
  let message = "";
  let source = "heuristic";

  try {
    const chat = await localAgentChat([
      { role: "system", content: ORCH_SYSTEM },
      {
        role: "user",
        content: [
          opts.projectId ? `projectId: ${opts.projectId}` : null,
          `Task: ${opts.task}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ]);
    source = chat.source;
    const raw = extractJson(chat.text) as Record<string, unknown>;
    summary = String(raw.summary ?? "Local plan");
    message = String(raw.message ?? chat.text.slice(0, 400));
    const arr = Array.isArray(raw.plan) ? raw.plan : [];
    plan = arr.map((s: any, i: number) => ({
      step: Number(s.step) || i + 1,
      worker: String(s.worker ?? "local"),
      action: String(s.action ?? "do"),
      detail: String(s.detail ?? ""),
      command: s.command != null ? String(s.command) : undefined,
      auto: Boolean(s.auto),
    }));
  } catch (e: unknown) {
    log.warn(`[localAgent] orchestrator LLM failed: ${e instanceof Error ? e.message : e}`);
    // Heuristic plan so UI still works offline
    summary = "Heuristic desktop plan (LLM offline)";
    message =
      e instanceof Error
        ? `LLM planner unavailable (${e.message}). Using local heuristic steps you can run in-app.`
        : "LLM offline — heuristic plan.";
    plan = [
      {
        step: 1,
        worker: "ollama",
        action: "ensure",
        detail: "Ensure GRUDACHAIN Ollama / local AI is running",
        command: undefined,
        auto: false,
      },
      {
        step: 2,
        worker: "fleet",
        action: "health",
        detail: "Probe ONE TRUTH client + game-data health",
        auto: false,
      },
      {
        step: 3,
        worker: "npm",
        action: "build",
        detail: "Build current workspace if package.json present",
        command: "npm run build",
        auto: true,
      },
      {
        step: 4,
        worker: "forge",
        action: "scene-complete",
        detail: "Open Forge → Scene Completion for weld/patch/rig",
        auto: false,
      },
    ];
    source = "heuristic";
  }

  if (!plan.length) {
    plan = [
      {
        step: 1,
        worker: "local",
        action: "review",
        detail: opts.task.slice(0, 200),
        auto: false,
      },
    ];
  }

  const executeLocally = plan.filter((p) => p.auto && p.command);

  return {
    ok: true,
    runId,
    status: "planned",
    workers,
    plan,
    summary,
    executeLocally,
    message,
    source,
  };
}

export async function localAgentStatus(): Promise<{
  ollama: Awaited<ReturnType<typeof ollama.getStatus>>;
  ready: boolean;
  mode: "local-first";
}> {
  let st: Awaited<ReturnType<typeof ollama.getStatus>>;
  try {
    st = await ollama.getStatus();
  } catch {
    st = {
      ok: false,
      host: await ollama.getOllamaHost().catch(() => "http://127.0.0.1:11434"),
      latencyMs: 0,
      backend: "none",
      container: { name: "GRUDACHAIN", exists: false, running: false, portsPublished: false },
      nativePath: null,
      nativeRunning: false,
      models: [],
      preferredModel: "llama3.2",
      aiPref: "auto",
      agenticReady: false,
      steps: [],
      error: "status failed",
    };
  }
  return {
    ollama: st,
    ready: true, // agent always attempts cloud fallback even if ollama down
    mode: "local-first",
  };
}
