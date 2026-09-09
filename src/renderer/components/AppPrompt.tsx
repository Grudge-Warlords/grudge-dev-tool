import React, { useRef, useState } from "react";
import { Bot, X } from "lucide-react";
import { AppControlsChangedError } from "../lib/appActionControls";
import { captureAppSurfaces, executeAppSurface } from "../lib/appActionSurfaces";
import { appControlValueMatches, validateAppActionDecision, type AppActionDecision, type AppActionRequest } from "../../shared/appActions";

const RECEIPT = "grudge:app-prompt:last-run";
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
interface Receipt { prompt: string; state: string; model?: string; history: AppActionRequest["history"]; startedAt: string; finishedAt?: string }
function retained(): Receipt | null { try { const r = JSON.parse(localStorage.getItem(RECEIPT) || "null"); return r?.state === "running" ? { ...r, state: "Interrupted; review completed actions before trying again." } : r; } catch { return null; } }
export default function AppPrompt({ route }: { route: string }) {
  const [open, setOpen] = useState(false), [prompt, setPrompt] = useState(""), [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(retained), [progress, setProgress] = useState("");
  const stopping = useRef(false), running = useRef(false), routeRef = useRef(route); routeRef.current = route;
  function record(r: Receipt) { const copy = structuredClone(r); setReceipt(copy); localStorage.setItem(RECEIPT, JSON.stringify(copy)); }
  async function run() {
    if (running.current || !prompt.trim()) return;
    running.current = true; stopping.current = false; setBusy(true);
    const r: Receipt = { prompt: prompt.trim(), state: "running", history: [], startedAt: new Date().toISOString() }; record(r);
    try {
      let waits = 0, changedScreens = 0;
      for (let i = 0; i < 40; i++) {
        if (stopping.current) { r.state = "Stopped; completed actions retained."; break; }
        // The existing creation service owns its job. Do not duplicate it while waiting.
        while (document.querySelector('[data-app-action-busy="true"]')) {
          if (stopping.current) break;
          setProgress("Waiting for the current app action…"); await pause(750);
        }
        if (stopping.current) { r.state = "Stopped; the current app job keeps its normal controls."; break; }
        const observed = await captureAppSurfaces(routeRef.current);
        const request: AppActionRequest = { prompt: r.prompt, snapshot: observed.snapshot, history: r.history };
        setProgress(`Grudge is choosing the next action (${r.history.length} completed)…`);
        const decision: AppActionDecision = await window.grudge.appActions.plan(request);
        if (stopping.current) { r.state = "Stopped; no further action was taken."; break; }
        validateAppActionDecision(decision, request); r.model = decision.model;
        if (routeRef.current !== observed.snapshot.route) throw new Error("The page changed during planning. Completed actions were retained.");
        if (decision.action === "done" || decision.action === "blocked") {
          if (observed.element) {
            const fresh = await captureAppSurfaces(routeRef.current);
            if (fresh.embedded?.documentId !== observed.embedded?.documentId || JSON.stringify(fresh.embedded?.snapshot) !== JSON.stringify(observed.embedded?.snapshot)) {
              if (++changedScreens > 3) throw new Error("The embedded app is still changing. Review its result before continuing.");
              continue;
            }
          }
          r.state = `${decision.action === "done" ? "Finished" : "Needs attention"}: ${decision.reason}`; break;
        }
        if (decision.action === "wait") { if (++waits > 12) throw new Error("The app has not supplied a result. Review its current state before continuing."); setProgress(decision.reason); await pause(1500); continue; }
        waits = 0;
        const key = `${decision.action} ${decision.target} ${decision.value}`.slice(0, 600);
        if (r.history.slice(-3).some(h => h.action === key)) throw new Error("Stopped a repeated action. Review the current app result before retrying.");
        let result: string;
        try { result = await executeAppSurface(decision, observed, r.prompt); }
        catch (error) {
          // Asset loading and editor selection may finish during inference.
          // Re-observe and plan afresh; never replay the stale decision.
          if (error instanceof AppControlsChangedError && ++changedScreens <= 3) { setProgress("The app updated; Grudge is checking its current controls…"); continue; }
          throw error;
        }
        changedScreens = 0; setProgress(result);
        // Retain the action before waiting for React or checking its result.
        // A post-action verification failure must not hide an applied change.
        r.history.push({ action: key, result: `${result}. Awaiting the app result.`.slice(0, 1200) }); record(r);
        await pause(700);
        const after = (await captureAppSurfaces(routeRef.current)).snapshot;
        r.history[r.history.length - 1].result = `${result}. Page: ${after.route}. ${after.status.join(" ")}`.slice(0, 1200); record(r);
        const previous = observed.snapshot.controls.find(c => c.id === decision.target)!;
        const equivalents = after.controls.filter(c => c.kind === previous.kind && c.label === previous.label && c.context === previous.context);
        const control = after.controls.find(c => c.id === decision.target) ?? (equivalents.length === 1 ? equivalents[0] : undefined);
        if (decision.action === "set" && (!control || !appControlValueMatches(control, decision.value))) throw new Error(`The ${previous.label} field did not retain a verifiable requested value.`);
      }
      if (r.state === "running") r.state = "Stopped at the 40-step limit; completed actions retained.";
    } catch (error) { r.state = `Needs attention: ${error instanceof Error ? error.message : String(error)}`; }
    finally { r.finishedAt = new Date().toISOString(); record(r); setBusy(false); running.current = false; setProgress(""); }
  }
  return <div data-grudge-command className="fixed bottom-10 left-3 z-[100]">
    {!open ? <button aria-label="Ask Grudge to act in the app" className="flex items-center gap-2 rounded-lg border border-gold/40 bg-bg-2 px-3 py-2 text-sm text-gold shadow-lg" onClick={() => setOpen(true)}><Bot size={16}/>Ask Grudge</button> :
      <section aria-label="App-wide prompt" className="w-[min(450px,calc(100vw-24px))] rounded-xl border border-gold/40 bg-bg-2 p-4 text-fg shadow-2xl">
        <div className="flex items-center justify-between"><b>Ask Grudge</b><button aria-label="Collapse app prompt" onClick={() => setOpen(false)}><X size={16}/></button></div>
        <p className="my-2 text-xs text-muted">Describe what to do in this app. Grudge uses the current screen and its existing controls.</p>
        <textarea aria-label="App action prompt" className="min-h-24 w-full rounded border border-line bg-bg p-2 text-sm" maxLength={2000} disabled={busy} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Open Prompt to 3D, create a blue cube, make it spin, and save it."/>
        <div className="mt-2 flex gap-2"><button className="flex-1 rounded bg-gold px-3 py-2 text-sm font-semibold text-black disabled:opacity-40" disabled={busy || !prompt.trim()} onClick={() => void run()}>{busy ? "Working…" : "Run in app"}</button>{busy && <button className="rounded border border-line px-3 text-sm" onClick={() => { stopping.current = true; setProgress("Stopping after the current request returns…"); }}>Stop</button>}</div>
        {progress && <p role="status" className="mt-2 text-xs text-gold">{progress}</p>}
        {receipt && <div className="mt-3 text-xs"><p role="status">{receipt.state}</p>{receipt.model && <p className="mt-1 text-muted">{receipt.model} · {receipt.history.length} actions</p>}<details className="mt-2 max-h-44 overflow-auto"><summary>Action record</summary>{receipt.history.map((h, i) => <p key={i} className="mt-2 break-words">{i + 1}. {h.result}</p>)}</details></div>}
      </section>}
  </div>;
}
