import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot, Mic, MicOff, Send, Loader2, Sparkles, Radio,
} from "lucide-react";
import { toast } from "sonner";
import { persistLegionChat, readMirror } from "../lib/workspace";

interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
  source?: string;
}

export default function Legion() {
  const [health, setHealth] = useState<any>(null);
  const [whisper, setWhisper] = useState<any>(null);
  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    const saved = readMirror().legionChat;
    if (saved?.length) return saved as ChatMsg[];
    return [{ role: "system", content: "ALE Legion online — Brother Keeper ready." }];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, w] = await Promise.all([
        window.grudge.legion.health(),
        window.grudge.legion.whisperHealth(),
      ]);
      setHealth(h);
      setWhisper(w);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    persistLegionChat(messages);
  }, [messages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: msg }]);
    try {
      const history = messages.filter((x) => x.role !== "system").slice(-8);
      const res = await window.grudge.legion.chat({
        message: msg,
        messages: [...history, { role: "user", content: msg }],
        role: "dev",
        model: "google/gemini-3.5-flash",
      });
      setMessages((m) => [...m, { role: "assistant", content: res.response || "(no response)", source: res.source }]);
    } catch (e: any) {
      toast.error("Legion chat failed", { description: e?.message });
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${e?.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Speech recognition unavailable — use Ollama whisper or type");
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (ev: any) => {
      const transcript = Array.from(ev.results)
        .map((r: any) => r[0].transcript)
        .join(" ")
        .trim();
      if (transcript.toUpperCase().includes("AL BABY")) {
        send(transcript);
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
    toast.success("Voice active — say AL BABY AL BABY AL BABY");
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  const hubOk = health?.hub?.status != null && health.hub.status < 500;
  const agentOk = health?.agent?.status != null && health.agent.status < 500;

  return (
    <div className="flex h-full">
      {/* Dist2 ALE Legion orb */}
      <div className="w-[420px] shrink-0 border-r border-line flex flex-col bg-bg-2/30">
        <div className="px-3 py-2 border-b border-line flex items-center gap-2">
          <Sparkles size={16} className="text-gold" />
          <span className="text-xs font-semibold">ALE Legion Orb</span>
          <span className={`ml-auto w-2 h-2 rounded-full ${hubOk || agentOk ? "bg-ok" : "bg-danger"}`} />
        </div>
        <iframe
          src="./legion/app.html"
          title="ALE Legion"
          className="flex-1 w-full border-0 bg-transparent"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>

      {/* Chat + orchestrator */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-2 border-b border-line flex items-center gap-3 bg-bg-2/50">
          <Bot size={18} className="text-gold" />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold">Legion Orchestrator</h1>
            <p className="text-[10px] text-muted truncate">
              {health?.hub?.url ?? "ai.grudge-studio.com"}
              {health?.hasFleetKey ? " · fleet key ✓" : " · no fleet key"}
              {whisper?.ok ? ` · whisper: ${whisper.model}` : " · whisper offline"}
            </p>
          </div>
          <button
            className={`btn text-xs flex items-center gap-1 ${listening ? "border-gold text-gold" : ""}`}
            onClick={listening ? stopVoice : startVoice}
            title="Wake phrase: AL BABY AL BABY AL BABY"
          >
            {listening ? <MicOff size={12} /> : <Mic size={12} />}
            {listening ? "Stop" : "Voice"}
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
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
              {m.source && <span className="block text-[9px] text-muted mt-1">via {m.source}</span>}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-muted text-xs">
              <Loader2 size={14} className="animate-spin" /> Legion thinking…
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="p-3 border-t border-line flex gap-2">
          <input
            className="flex-1 text-xs"
            placeholder="Ask Legion / GRUDA…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            disabled={busy}
          />
          <button className="btn text-xs flex items-center gap-1" onClick={() => send()} disabled={busy || !input.trim()}>
            <Send size={12} /> Send
          </button>
        </div>

        <div className="px-3 py-1.5 border-t border-line text-[9px] text-muted flex gap-3">
          <span className="flex items-center gap-1">
            <Radio size={10} className={hubOk ? "text-green-400" : "text-danger"} />
            Hub {hubOk ? "online" : "offline"}
          </span>
          <span className="flex items-center gap-1">
            <Radio size={10} className={agentOk ? "text-green-400" : "text-danger"} />
            GRUDA {agentOk ? "online" : "offline"}
          </span>
        </div>
      </div>
    </div>
  );
}