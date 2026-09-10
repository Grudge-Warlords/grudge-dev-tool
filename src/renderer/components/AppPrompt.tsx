import AppControlWindow from "./AppControlWindow";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Bot, X } from "lucide-react";
import { AppControlsChangedError } from "../lib/appActionControls";
import { captureAppSurfaces, executeAppSurface } from "../lib/appActionSurfaces";
import { appControlValueMatches, validateAppActionDecision, type AppActionDecision, type AppActionRequest } from "../../shared/appActions";

const RECEIPT = "grudge:app-prompt:last-run";
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
interface Receipt { prompt: string; state: string; model?: string; history: AppActionRequest["history"]; startedAt: string; finishedAt?: string }
interface AppPromptController { busy: boolean; receipt: Receipt | null; progress: string; run(prompt: string): Promise<void>; stop(): void }
const AppPromptContext = createContext<AppPromptController | null>(null);
export function useAppPrompt() {
  const controller = useContext(AppPromptContext);
  if (!controller) throw new Error("The app prompt controller is unavailable.");
  return controller;
}
function retained(): Receipt | null { try { const r = JSON.parse(localStorage.getItem(RECEIPT) || "null"); return r?.state === "running" ? { ...r, state: "Interrupted; review completed actions before trying again." } : r; } catch { return null; } }
export function AppPromptProvider({ route, children }: { route: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(retained), [progress, setProgress] = useState("");
  const stopping = useRef(false), running = useRef(false), routeRef = useRef(route); routeRef.current = route;
  function record(r: Receipt) { const copy = structuredClone(r); setReceipt(copy); try { localStorage.setItem(RECEIPT, JSON.stringify(copy)); } catch { /* Keep the live receipt usable when browser storage is full. */ } }
  function stop() { stopping.current = true; setProgress("Stopping after the current request returns…"); }
  async function run(prompt: string) {
    if (running.current || !prompt.trim() || prompt.length > 2000) return;
    running.current = true; stopping.current = false; setBusy(true);
    const r: Receipt = { prompt: prompt.trim(), state: "running", history: [], startedAt: new Date().toISOString() }; record(r);
    setProgress("Grudge is analysing your request…");
    try {
      await window.grudge.appNative.begin();
      let waits = 0, changedScreens = 0;
      for (let i = 0; i < 40; i++) {
        if (stopping.current) { r.state = "Stopped; completed actions retained."; break; }
        // The existing creation service owns its job. Do not duplicate it while waiting.
        while (document.querySelector('[data-app-action-busy="true"]') && !await window.grudge.appNative.dialog()) {
          if (stopping.current) break;
          setProgress("Waiting for the current app action…"); await pause(750);
        }
        if (stopping.current) { r.state = "Stopped; the current app job keeps its normal controls."; break; }
        const observed = await captureAppSurfaces(routeRef.current);
        // Creation may finish after the initial post-click observation. Retain
        // its actual completion before a following handoff removes that page.
        const latestAction = r.history.at(-1);
        const savedRevision = observed.snapshot.status.find(s => /^Saved revision\b/.test(s));
        if (latestAction?.result.startsWith("Activated Run prompt") && savedRevision && !latestAction.result.includes("Saved revision")) {
          latestAction.result = `${latestAction.result.slice(0, 600)}. ${savedRevision}`.slice(0, 1200);
          record(r);
        }
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
        let after = (await captureAppSurfaces(routeRef.current)).snapshot;
        const previous = observed.snapshot.controls.find(c => c.id === decision.target)!;
        const findControl = () => {
          const equivalents = after.controls.filter(c => c.kind === previous.kind && c.label === previous.label && c.context === previous.context);
          return after.controls.find(c => c.id === decision.target) ?? (equivalents.length === 1 ? equivalents[0] : undefined);
        };
        let control = findControl();
        // IPC-backed settings settle asynchronously. Observe their result for a
        // bounded interval without clicking or setting the control a second time.
        for (let settle = 0; decision.action === "set" && (!control || !appControlValueMatches(control, decision.value)) && settle < 20 && !stopping.current; settle++) {
          await pause(250);
          after = (await captureAppSurfaces(routeRef.current)).snapshot;
          control = findControl();
        }
        r.history[r.history.length - 1].result = `${result}. Page: ${after.route}. ${after.status.join(" ")}`.slice(0, 1200); record(r);
        if (decision.action === "set" && (!control || !appControlValueMatches(control, decision.value))) throw new Error(`The ${previous.label} field did not retain a verifiable requested value.`);
      }
      if (r.state === "running") r.state = "Stopped at the 40-step limit; completed actions retained.";
    } catch (error) { r.state = `Needs attention: ${error instanceof Error ? error.message : String(error)}`; }
    finally { await window.grudge.appNative.end().catch(() => undefined); r.finishedAt = new Date().toISOString(); record(r); setBusy(false); running.current = false; setProgress(""); }
  }
  return <AppPromptContext.Provider value={{ busy, receipt, progress, run, stop }}>{children}<AppControlWindow/></AppPromptContext.Provider>;
}

export function AppPromptResult() {
  const { receipt, progress } = useAppPrompt();
  return <>
    {progress && <p role="status" className="mt-2 text-xs text-gold">{progress}</p>}
    {receipt && <div className="mt-3 text-xs">{receipt.state!=="running"&&<p role="status">{receipt.state}</p>}<details className="mt-2 max-h-44 overflow-auto"><summary className="w-fit cursor-pointer text-muted">Action record{receipt.history.length?` · ${receipt.history.length} steps`:""}</summary>{receipt.model&&<p className="mt-2 text-muted">{receipt.model}</p>}<p className="mt-2 break-words">{receipt.prompt}</p>{receipt.history.map((h, i) => <p key={i} className="mt-2 break-words">{i + 1}. {h.result}</p>)}</details></div>}
  </>;
}

export default function AppPrompt({ route }: { route: string }) {
  const [open, setOpen] = useState(false), [prompt, setPrompt] = useState("");
  const { busy, run, stop, progress } = useAppPrompt();
  useEffect(() => { if (busy && route !== "/prompt3d") setOpen(true); }, [busy, route]);
  // The page and floating prompt share one runner which survives navigation.
  if (route === "/prompt3d") return null;
  if (busy) return <div data-grudge-command className="fixed bottom-10 left-3 z-[100] flex max-w-[min(420px,90vw)] items-center gap-3 rounded-lg border border-gold/40 bg-bg-2 px-3 py-2 text-xs shadow-lg"><Bot size={16} className="shrink-0 text-gold"/><span role="status" className="truncate">{progress || "Grudge is working…"}</span><button className="shrink-0 rounded border border-line px-2 py-1" onClick={stop}>Stop</button></div>;
  return <div data-grudge-command className="fixed bottom-10 left-3 z-[100]">
    {!open ? <button aria-label="Ask Grudge to act in the app" className="flex items-center gap-2 rounded-lg border border-gold/40 bg-bg-2 px-3 py-2 text-sm text-gold shadow-lg" onClick={() => setOpen(true)}><Bot size={16}/>Ask Grudge</button> :
      <section aria-label="App-wide prompt" className="w-[min(450px,calc(100vw-24px))] rounded-xl border border-gold/40 bg-bg-2 p-4 text-fg shadow-2xl">
        <div className="flex items-center justify-between"><b>Ask Grudge</b><button aria-label="Collapse app prompt" onClick={() => setOpen(false)}><X size={16}/></button></div>
        <p className="my-2 text-xs text-muted">Describe what to do in this app. Grudge uses the current screen and its existing controls.</p>
        <textarea aria-label="App action prompt" className="min-h-24 w-full rounded border border-line bg-bg p-2 text-sm" maxLength={2000} disabled={busy} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Open Prompt to 3D, create a blue cube, make it spin, and save it."/>
        <div className="mt-2 flex gap-2"><button className="flex-1 rounded bg-gold px-3 py-2 text-sm font-semibold text-black disabled:opacity-40" disabled={busy || !prompt.trim()} onClick={() => void run(prompt)}>{busy ? "Working…" : "Run in app"}</button>{busy && <button className="rounded border border-line px-3 text-sm" onClick={stop}>Stop</button>}</div>
        <AppPromptResult/>
      </section>}
  </div>;
}
