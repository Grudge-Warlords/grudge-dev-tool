import { workspaceChat } from "./anythingllm";
import { chatHuggingface } from "./huggingface";
import {
  AGENT_SYSTEM_TOOLS,
  extractToolCall,
  runAgentTool,
} from "./agentTools";
import { ollamaChat } from "../ollama";

export interface GrudaChainChatOpts {
  message: string;
  sessionId?: string;
  workspaceSlug?: string;
  history?: Array<{ role: string; content: string }>;
  enableTools?: boolean;
  /** Max tool rounds (default 5 when agentic). */
  maxToolRounds?: number;
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
    .slice(-8)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  let prompt = `${AGENT_SYSTEM_TOOLS}\n\n---\nConversation:\n${userBlock}\nuser: ${opts.message}`;
  const toolTrace: string[] = [];
  let sessionId = opts.sessionId;
  let lastResponse = "";
  let source = "grudachain:anythingllm";

  const maxRounds = opts.enableTools === false ? 1 : (opts.maxToolRounds ?? 5);

  for (let round = 0; round < maxRounds; round++) {
    let result: { response: string; sessionId?: string };

    // Prefer AnythingLLM RAG → HF → full provider chain
    try {
      const rag = await workspaceChat({
        message: prompt,
        mode: round === 0 ? "chat" : "query",
        sessionId,
        workspaceSlug: opts.workspaceSlug,
      });
      result = { response: rag.response, sessionId: rag.sessionId };
      source = "grudachain:anythingllm";
    } catch (ragErr: unknown) {
      // Do NOT call chatWithProviderChain here — it re-enters grudachainChat.
      try {
        const hf = await chatHuggingface({
          messages: [
            { role: "system", content: AGENT_SYSTEM_TOOLS },
            ...history.filter((m) => m.role === "user" || m.role === "assistant").slice(-6),
            { role: "user", content: prompt },
          ],
          max_tokens: 2048,
        });
        result = { response: hf.response };
        source = hf.source;
      } catch {
        const o = await ollamaChat({
          messages: [
            { role: "system", content: AGENT_SYSTEM_TOOLS },
            ...history.filter((m) => m.role === "user" || m.role === "assistant").slice(-6),
            { role: "user", content: prompt },
          ],
        });
        result = { response: o.message?.content ?? "" };
        source = "ollama";
      }
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
      toolOut = await runAgentTool(tool);
    } catch (e: unknown) {
      toolOut = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }

    const moreTools = round < maxRounds - 1;
    prompt = `${AGENT_SYSTEM_TOOLS}\n\nTool ${tool.tool} result:\n${toolOut}\n\nOriginal question: ${opts.message}\n${
      moreTools
        ? "If another tool is needed, emit one more <tool>…</tool>. Otherwise answer the developer with what changed and next steps."
        : "Answer the developer now — no further tool calls."
    }`;
  }

  return {
    response: lastResponse.replace(/<tool>[\s\S]*?<\/tool>/g, "").trim() || lastResponse,
    source,
    sessionId,
    toolTrace: toolTrace.length ? toolTrace : undefined,
  };
}
