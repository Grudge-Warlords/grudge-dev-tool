import { workspaceChat } from "./anythingllm";
import { chatHuggingface } from "./huggingface";
import { r2List, r2PublicUrl } from "../cf/r2Direct";
import { fetchObjectStoreCatalog } from "../legion/orchestrator";
import { FLEET_GAMES } from "../../shared/fleetGames";

const GRUDACHAIN_SYSTEM = `You are GRUDA — the Grudge Studio agentic dev copilot inside Grudge Dev Tool.
You have RAG knowledge from the user's AnythingLLM workspace (Grudge-trained docs, pipelines, lore).
You can request tools by replying with a single JSON line wrapped in <tool>...</tool> tags, then wait for results.

Available tools:
- r2_list: { "prefix": "asset-packs/", "limit": 20 } — list R2 object keys
- r2_url: { "key": "path/to/asset.glb" } — public CDN URL for an R2 key
- objectstore: { "path": "/catalog.json" } — fetch ObjectStore JSON
- fleet: {} — list Grudge fleet games

After tool results arrive, synthesize a concise answer for the developer. Prefer actionable steps (Forge, Upload, Coder, deploy).
Never invent asset URLs — use tool outputs. Grudge CDN default: https://assets.grudge-studio.com`;

type ToolName = "r2_list" | "r2_url" | "objectstore" | "fleet";

interface ToolCall {
  tool: ToolName;
  args?: Record<string, unknown>;
}

function extractToolCall(text: string): ToolCall | null {
  const m = text.match(/<tool>\s*(\{[\s\S]*?\})\s*<\/tool>/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]) as ToolCall;
    if (parsed?.tool) return parsed;
  } catch { /* ignore */ }
  return null;
}

async function runTool(call: ToolCall): Promise<string> {
  switch (call.tool) {
    case "r2_list": {
      const prefix = String(call.args?.prefix ?? "");
      const limit = Number(call.args?.limit ?? 25);
      const list = await r2List({ prefix, limit, delimiter: "/" });
      return JSON.stringify({
        prefix: list.prefix,
        folders: list.folders?.slice(0, 15),
        items: list.items.slice(0, limit).map((i) => ({ name: i.name, size: i.size })),
      }, null, 2);
    }
    case "r2_url": {
      const key = String(call.args?.key ?? "");
      const url = await r2PublicUrl(key);
      return JSON.stringify({ key, url });
    }
    case "objectstore": {
      const path = String(call.args?.path ?? "/");
      const data = await fetchObjectStoreCatalog(path);
      return JSON.stringify(data).slice(0, 8000);
    }
    case "fleet": {
      return JSON.stringify(
        FLEET_GAMES.slice(0, 40).map((g) => ({ id: g.id, name: g.displayName, url: g.url, status: g.status })),
        null,
        2,
      );
    }
    default:
      return JSON.stringify({ error: "unknown tool" });
  }
}

export interface GrudaChainChatOpts {
  message: string;
  sessionId?: string;
  workspaceSlug?: string;
  history?: Array<{ role: string; content: string }>;
  enableTools?: boolean;
}

export interface GrudaChainChatResult {
  response: string;
  source: string;
  sessionId?: string;
  toolTrace?: string[];
}

export async function grudachainChat(opts: GrudaChainChatOpts): Promise<GrudaChainChatResult> {
  const history = opts.history ?? [];
  const userBlock = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  let prompt = `${GRUDACHAIN_SYSTEM}\n\n---\nConversation:\n${userBlock}\nuser: ${opts.message}`;
  const toolTrace: string[] = [];
  let sessionId = opts.sessionId;
  let lastResponse = "";

  let source = "grudachain:anythingllm";

  for (let round = 0; round < (opts.enableTools !== false ? 3 : 1); round++) {
    let result: { response: string; sessionId?: string };
    try {
      const rag = await workspaceChat({
        message: prompt,
        mode: round === 0 ? "chat" : "query",
        sessionId,
        workspaceSlug: opts.workspaceSlug,
      });
      result = { response: rag.response, sessionId: rag.sessionId };
    } catch (ragErr: unknown) {
      const hf = await chatHuggingface({
        messages: [
          { role: "system", content: GRUDACHAIN_SYSTEM },
          ...history.filter((m) => m.role === "user" || m.role === "assistant").slice(-6),
          { role: "user", content: prompt },
        ],
        max_tokens: 1536,
      });
      result = { response: hf.response };
      source = hf.source;
      if (round === 0 && ragErr instanceof Error) {
        toolTrace.push(`rag-fallback: ${ragErr.message.slice(0, 80)}`);
      }
    }
    lastResponse = result.response;
    sessionId = result.sessionId ?? sessionId;

    if (opts.enableTools === false) break;
    const tool = extractToolCall(lastResponse);
    if (!tool) break;

    toolTrace.push(tool.tool);
    let toolOut: string;
    try {
      toolOut = await runTool(tool);
    } catch (e: unknown) {
      toolOut = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
    prompt = `${GRUDACHAIN_SYSTEM}\n\nTool ${tool.tool} result:\n${toolOut}\n\nOriginal question: ${opts.message}\nAnswer the developer now without another tool call unless necessary.`;
  }

  return {
    response: lastResponse.replace(/<tool>[\s\S]*?<\/tool>/g, "").trim() || lastResponse,
    source,
    sessionId,
    toolTrace: toolTrace.length ? toolTrace : undefined,
  };
}