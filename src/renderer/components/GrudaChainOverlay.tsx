import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot, ChevronDown, Database, Loader2, Send, Sparkles, X, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { persistGrudachainChat, readMirror } from "../lib/workspace";

interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
  source?: string;
  tools?: string[];
}

const QUICK_PROMPTS = [
  { label: "Coder IDE", text: "Help me evolve coder.grudge-studio.com — suggest UI/UX improvements and agentic HF integration patterns." },
  { label: "R2 assets", text: "List top-level folders in our R2 bucket under asset-packs/ and suggest what to upload next." },
  { label: "Fleet deploy", text: "Which Grudge fleet games are live and how do I open them from the dev tool?" },
  { label: "Forge pipeline", text: "Walk me through convert → GLB → R2 upload in Forge 3D for a new character." },
];

export default function GrudaChainOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [health, setHealth] = useState<any>(null);
  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    const saved = readMirror().grudachainChat;
    if (saved?.length) return saved as ChatMsg[];
    return [{
      role: "system",
      content: "GRUDA Chain — AnythingLLM RAG + R2-trained Grudge context. Ctrl+/ to toggle.",
    }];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [agentic, setAgentic] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await window.grudge.grudachain.health());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) refreshHealth();
  }, [open, refreshHealth]);

  useEffect(() => {
    persistGrudachainChat(messages);
  }, [messages]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: msg }]);
    try {
      const history = messages.filter((x) => x.role !== "system").slice(-10);
      const res = await window.grudge.grudachain.chat({
        message: msg,
        sessionId,
        history,
        enableTools: agentic,
      });
      if (res.sessionId) setSessionId(res.sessionId);
      setMessages((m) => [...m, {
        role: "assistant",
        content: res.response || "(no response)",
        source: res.source,
        tools: res.toolTrace,
      }]);
    } catch (e: any) {
      toast.error("GRUDA Chain failed", { description: e?.message });
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${e?.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const ragOk = health?.ok;
  const ws = health?.workspaceSlug ?? "assistant-chats";

  return (
    <div className="grudachain-backdrop" onClick={onClose} role="presentation">
      <div
        className="grudachain-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="GRUDA Chain AI"
      >
        <header className="grudachain-header">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grudachain-orb">
              <Sparkles size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gold truncate">GRUDA Chain</div>
              <div className="text-[10px] text-muted truncate flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${ragOk ? "bg-ok" : "bg-danger"}`} />
                AnythingLLM · {ws}
                {ragOk ? " · RAG online" : " · check API key in Settings"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={`grudachain-chip ${agentic ? "active" : ""}`}
              onClick={() => setAgentic((v) => !v)}
              title="Agentic mode — R2 / fleet / ObjectStore tools"
            >
              <Zap size={11} /> Agent
            </button>
            <button type="button" className="grudachain-icon-btn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="grudachain-quick">
          {QUICK_PROMPTS.map((q) => (
            <button key={q.label} type="button" className="grudachain-chip" onClick={() => send(q.text)} disabled={busy}>
              {q.label}
            </button>
          ))}
        </div>

        <div className="grudachain-messages">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`grudachain-msg grudachain-msg--${m.role}`}
            >
              {m.role === "assistant" && <Bot size={12} className="inline mr-1 opacity-60" />}
              {m.role === "user" && <Database size={12} className="inline mr-1 opacity-60" />}
              <span>{m.content}</span>
              {m.tools?.length ? (
                <span className="block text-[9px] text-muted mt-1">tools: {m.tools.join(" → ")}</span>
              ) : null}
              {m.source && (
                <span className="block text-[9px] text-muted mt-0.5">via {m.source}</span>
              )}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-muted text-xs px-2">
              <Loader2 size={14} className="animate-spin text-gold" />
              GRUDA thinking…
            </div>
          )}
          <div ref={endRef} />
        </div>

        <footer className="grudachain-footer">
          <input
            className="grudachain-input"
            placeholder="Ask GRUDA — R2, fleet, Forge, trained lore…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            disabled={busy}
            autoFocus
          />
          <button type="button" className="grudachain-send" onClick={() => send()} disabled={busy || !input.trim()}>
            <Send size={14} />
          </button>
        </footer>
        <div className="grudachain-hint">
          <ChevronDown size={10} className="inline opacity-50" /> Ctrl+/ anywhere · Esc to close
        </div>
      </div>
    </div>
  );
}