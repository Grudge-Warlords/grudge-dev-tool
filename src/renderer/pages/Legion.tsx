import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot, Database, ExternalLink, Mic, MicOff, Send, Loader2, Sparkles, Radio, Zap,
  Trash2, RefreshCcw, Users,
} from "lucide-react";
import { toast } from "sonner";
import { persistLegionChat, readMirror } from "../lib/workspace";

interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
  source?: string;
  tools?: string[];
}

const WAKE_RE = /AL\s*BABY/i;

const STARTER_PROMPTS = [
  "List fleet games and their status",
  "What R2 asset packs are available?",
  "How do I open a GLB in Forge 3D?",
  "Summarize ONE TRUTH connectivity checks",
];

export default function Legion() {
  const [health, setHealth] = useState<any>(null);
  const [grudaHealth, setGrudaHealth] = useState<any>(null);
  const [whisper, setWhisper] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [mode, setMode] = useState<"grudachain" | "legion">("grudachain");
  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    const saved = readMirror().grudachainChat ?? readMirror().legionChat;
    if (saved?.length) return saved as ChatMsg[];
    return [{ role: "system", content: "GRUDA Chain / Legion — AnythingLLM RAG + agentic R2 tools. Ctrl+/ for quick overlay." }];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [agentic, setAgentic] = useState(true);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, w, g, a] = await Promise.all([
        window.grudge.legion.health(),
        window.grudge.legion.whisperHealth(),
        window.grudge.grudachain.health(),
        window.grudge.legion.agents().catch(() => []),
      ]);
      setHealth(h);
      setWhisper(w);
      setGrudaHealth(g);
      setAgents(Array.isArray(a) ? a : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (mode === "grudachain") {
      import("../lib/workspace").then((m) => m.persistGrudachainChat(messages));
    } else {
      persistLegionChat(messages);
    }
  }, [messages, mode]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  function clearChat() {
    const intro: ChatMsg = {
      role: "system",
      content: mode === "grudachain"
        ? "GRUDA Chain — AnythingLLM RAG + agentic R2 tools. Ctrl+/ for quick overlay."
        : "Legion Hub — fleet AI chat via provider chain.",
    };
    setMessages([intro]);
    setSessionId(undefined);
    toast.message("Chat cleared");
  }

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: msg }]);
    try {
      const history = messages.filter((x) => x.role !== "system").slice(-10);
      if (mode === "grudachain") {
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
      } else {
        const res = await window.grudge.legion.chat({
          message: msg,
          messages: [...history, { role: "user", content: msg }],
          role: "dev",
          model: "llama-3.3-70b-versatile",
        });
        setMessages((m) => [...m, { role: "assistant", content: res.response || "(no response)", source: res.source }]);
      }
    } catch (e: any) {
      toast.error("Chat failed", { description: e?.message });
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${e?.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function transcribeChunks(chunks: Blob[]) {
    if (!chunks.length) return;
    setTranscribing(true);
    try {
      const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const res = await window.grudge.legion.transcribe({
        audioBase64: btoa(binary),
        model: whisper?.model,
      });
      const text = (res.text ?? "").trim();
      if (!text) { toast.message("No speech detected"); return; }
      await send(text.replace(WAKE_RE, "").trim() || text);
    } catch (e: any) {
      toast.error("Whisper failed", { description: e?.message });
    } finally {
      setTranscribing(false);
    }
  }

  function startVoice() {
    if (whisper?.ok) {
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;
          audioChunksRef.current = [];
          const rec = new MediaRecorder(stream);
          rec.ondataavailable = (ev) => { if (ev.data.size > 0) audioChunksRef.current.push(ev.data); };
          rec.onstop = () => {
            void transcribeChunks([...audioChunksRef.current]);
            stream.getTracks().forEach((t) => t.stop());
          };
          mediaRecorderRef.current = rec;
          rec.start();
          setListening(true);
        } catch (e: any) {
          toast.error("Microphone unavailable", { description: e?.message });
        }
      })();
    } else {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) { toast.error("Speech unavailable"); return; }
      const rec = new SR();
      rec.continuous = true;
      rec.lang = "en-US";
      rec.onresult = (ev: any) => {
        const t = Array.from(ev.results).map((r: any) => r[0].transcript).join(" ").trim();
        if (WAKE_RE.test(t)) void send(t.replace(WAKE_RE, "").trim());
      };
      rec.onend = () => setListening(false);
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    }
  }

  function stopVoice() {
    mediaRecorderRef.current?.stop();
    recognitionRef.current?.stop();
    setListening(false);
  }

  const hubOk = health?.hub?.status != null && health.hub.status < 500;
  const agentOk = health?.agent?.status != null && health.agent.status < 500;
  const ragOk = grudaHealth?.ok;
  const openAnythingLlm = () => {
    window.grudge?.os?.openExternal?.("http://localhost:3001");
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="w-[380px] shrink-0 border-r border-line flex flex-col bg-bg-2/30">
        <div className="px-3 py-2 border-b border-line">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={16} className="text-gold" />
            <span className="text-xs font-semibold">Legion / GRUDA</span>
            <span className={`ml-auto w-2 h-2 rounded-full ${ragOk || hubOk ? "bg-ok" : "bg-danger"}`} />
          </div>
          <p className="text-[10px] text-muted leading-relaxed">
            Local AnythingLLM on port 3001 — Grudge-trained workspace + R2 asset context.
            Press <span className="kbd">Ctrl+/</span> for the floating assistant.
          </p>
          <div className="flex gap-2 mt-2">
            <button type="button" className="btn ghost text-[10px] flex-1 flex items-center justify-center gap-1" onClick={openAnythingLlm}>
              <ExternalLink size={11} /> AnythingLLM
            </button>
            <button type="button" className="btn ghost text-[10px] flex items-center justify-center gap-1" onClick={() => void refresh()}>
              <RefreshCcw size={11} />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[9px]">
            <div className={`rounded border px-1.5 py-1 ${ragOk ? "border-emerald-500/40 text-emerald-300" : "border-line text-muted"}`}>
              RAG {ragOk ? "online" : "offline"}
              {grudaHealth?.latencyMs != null && <span className="block opacity-70">{grudaHealth.latencyMs}ms</span>}
            </div>
            <div className={`rounded border px-1.5 py-1 ${hubOk ? "border-emerald-500/40 text-emerald-300" : "border-line text-muted"}`}>
              Hub {hubOk ? "ok" : "down"}
              {health?.hub?.latencyMs != null && <span className="block opacity-70">{health.hub.latencyMs}ms</span>}
            </div>
            <div className={`rounded border px-1.5 py-1 ${agentOk ? "border-emerald-500/40 text-emerald-300" : "border-line text-muted"}`}>
              Agent {agentOk ? "ok" : "down"}
              {health?.agent?.latencyMs != null && <span className="block opacity-70">{health.agent.latencyMs}ms</span>}
            </div>
            <div className={`rounded border px-1.5 py-1 ${whisper?.ok ? "border-emerald-500/40 text-emerald-300" : "border-line text-muted"}`}>
              Whisper {whisper?.ok ? "ok" : "n/a"}
            </div>
          </div>

          {agents.length > 0 && (
            <div className="mt-2 border-t border-line pt-2">
              <div className="flex items-center gap-1 text-[10px] text-muted mb-1">
                <Users size={10} /> Legion agents ({agents.length})
              </div>
              <ul className="max-h-24 overflow-auto space-y-0.5">
                {agents.slice(0, 12).map((a: any, i: number) => (
                  <li key={a.id ?? a.name ?? i} className="text-[10px] text-ink/80 truncate">
                    {a.name ?? a.id ?? a.role ?? `agent-${i + 1}`}
                    {a.status ? <span className="text-muted"> · {a.status}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <iframe
          src="./legion/app.html"
          title="ALE Legion Orb"
          className="flex-1 w-full border-0 bg-transparent min-h-[200px]"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-2 border-b border-line flex items-center gap-3 bg-bg-2/50 flex-wrap">
          <Bot size={18} className="text-gold" />
          <div className="flex gap-1">
            <button type="button" className={`grudachain-chip ${mode === "grudachain" ? "active" : ""}`} onClick={() => setMode("grudachain")}>
              <Database size={11} className="inline mr-1" /> GrudaChain RAG
            </button>
            <button type="button" className={`grudachain-chip ${mode === "legion" ? "active" : ""}`} onClick={() => setMode("legion")}>
              Legion Hub
            </button>
          </div>
          {mode === "grudachain" && (
            <button type="button" className={`grudachain-chip ${agentic ? "active" : ""}`} onClick={() => setAgentic((v) => !v)}>
              <Zap size={11} className="inline mr-1" /> Agentic
            </button>
          )}
          <p className="text-[10px] text-muted flex-1 min-w-[120px] truncate">
            {mode === "grudachain"
              ? `${grudaHealth?.baseUrl ?? "localhost:3001"} · ${grudaHealth?.workspaceSlug ?? "workspace"}`
              : `${health?.hub?.url ?? "ai.grudge-studio.com"}`}
          </p>
          <button type="button" className="btn ghost text-xs flex items-center gap-1" onClick={clearChat} title="Clear chat">
            <Trash2 size={12} />
          </button>
          <button
            type="button"
            className="btn ghost text-xs flex items-center gap-1"
            onClick={listening || transcribing ? stopVoice : startVoice}
            disabled={transcribing}
          >
            {listening || transcribing ? <MicOff size={12} /> : <Mic size={12} />}
            Voice
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="text-[10px] px-2 py-1 rounded border border-line text-muted hover:border-gold/40 hover:text-gold"
                  onClick={() => void send(p)}
                  disabled={busy}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`text-xs p-2 rounded max-w-[90%] ${
                m.role === "user" ? "ml-auto bg-gold/10 border border-gold/20" :
                  m.role === "system" ? "text-muted text-center mx-auto border border-line/50" :
                    "bg-bg-2 border border-line"
              }`}
            >
              {m.content}
              {m.tools?.length ? <span className="block text-[9px] text-muted mt-1">tools: {m.tools.join(" → ")}</span> : null}
              {m.source && <span className="block text-[9px] text-muted mt-1">via {m.source}</span>}
            </div>
          ))}
          {(busy || transcribing) && (
            <div className="flex items-center gap-2 text-muted text-xs">
              <Loader2 size={14} className="animate-spin" />
              {transcribing ? "Transcribing…" : "Thinking…"}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="p-3 border-t border-line flex gap-2">
          <input
            className="flex-1 text-xs"
            placeholder={mode === "grudachain" ? "Ask GRUDA — R2, fleet, trained docs…" : "Ask Legion / GRUDA hub…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            disabled={busy}
          />
          <button type="button" className="btn text-xs flex items-center gap-1" onClick={() => send()} disabled={busy || !input.trim()}>
            <Send size={12} /> Send
          </button>
        </div>

        <div className="px-3 py-1.5 border-t border-line text-[9px] text-muted flex gap-3 flex-wrap">
          <span className="flex items-center gap-1">
            <Radio size={10} className={ragOk ? "text-green-400" : "text-danger"} />
            RAG {ragOk ? "online" : "offline"}
          </span>
          <span className="flex items-center gap-1">
            <Radio size={10} className={hubOk ? "text-green-400" : "text-danger"} />
            Legion {hubOk ? "online" : "offline"}
          </span>
          <span className="flex items-center gap-1">
            <Radio size={10} className={agentOk ? "text-green-400" : "text-danger"} />
            Agent {agentOk ? "online" : "offline"}
          </span>
          {health?.hasFleetKey && <span className="text-gold">fleet key set</span>}
        </div>
      </div>
    </div>
  );
}
