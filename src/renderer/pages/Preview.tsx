import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, RotateCw, FolderOpen, X, ExternalLink, Bug,
} from "lucide-react";
import { toast } from "sonner";

// Electron's <webview> tag is already declared by @types/react
// (WebViewHTMLAttributes<HTMLWebViewElement>). We just need a typed handle
// for the imperative methods we call on the element.
interface WebviewEl extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  loadURL(url: string): Promise<void>;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  getURL(): string;
}

const HOME_URL = "about:blank";

/** Coerce a typed string into a full URL we can pass to a webview. */
function normalizeAddress(raw: string): string {
  const s = raw.trim();
  if (!s) return HOME_URL;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;       // already a URL
  if (s.startsWith("about:")) return s;
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith("\\\\")) { // Windows absolute path
    return "file:///" + s.replace(/\\/g, "/");
  }
  if (s.startsWith("/")) return "file://" + s;             // POSIX absolute path
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(s)) return "https://" + s;
  return s;
}

export default function Preview() {
  const wvRef = useRef<WebviewEl | null>(null);
  const [pending, setPending] = useState<string>(HOME_URL);
  const [loading, setLoading] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);

  // Wire webview events once the element is mounted. The webview tag fires
  // standard Electron events as DOM CustomEvents.
  useEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;
    const refreshNav = () => {
      try { setCanBack(wv.canGoBack()); setCanFwd(wv.canGoForward()); } catch { /* ignore */ }
    };
    const onStart = () => setLoading(true);
    const onStop = () => { setLoading(false); refreshNav(); };
    const onNavigate = (e: { url?: string }) => { setPending(e.url ?? wv.getURL()); refreshNav(); };
    const onFail = (e: { errorCode: number; errorDescription?: string }) => {
      setLoading(false);
      if (e.errorCode === -3) return; // ABORTED — caused by stop()/reload race; ignore
      toast.error(`Load failed: ${e.errorDescription ?? e.errorCode}`);
    };
    wv.addEventListener("did-start-loading", onStart);
    wv.addEventListener("did-stop-loading", onStop);
    wv.addEventListener("did-navigate", onNavigate as unknown as EventListener);
    wv.addEventListener("did-navigate-in-page", onNavigate as unknown as EventListener);
    wv.addEventListener("did-fail-load", onFail as unknown as EventListener);
    return () => {
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", onStop);
      wv.removeEventListener("did-navigate", onNavigate as unknown as EventListener);
      wv.removeEventListener("did-navigate-in-page", onNavigate as unknown as EventListener);
      wv.removeEventListener("did-fail-load", onFail as unknown as EventListener);
    };
  }, []);

  const go = useCallback((raw: string) => {
    const url = normalizeAddress(raw);
    setPending(url);
    wvRef.current?.loadURL(url).catch(() => { /* surfaced via did-fail-load */ });
  }, []);

  const openHtml = useCallback(async () => {
    try {
      const r = await window.grudge.preview.openHtmlDialog();
      if (r.canceled || !r.url) return;
      go(r.url);
    } catch (err: any) {
      toast.error("Open failed", { description: err?.message ?? String(err) });
    }
  }, [go]);

  const openExternal = useCallback(() => {
    const u = wvRef.current?.getURL() ?? pending;
    if (!u || u === HOME_URL) return;
    window.grudge?.os?.openExternal?.(u);
  }, [pending]);

  return (
    <div className= "flex flex-col h-full" >
    <div className="flex items-center gap-1.5 p-2 border-b border-line bg-bg-1/40" >
    <button
          className="p-1.5 rounded hover:bg-bg-2 disabled:opacity-40"
  disabled = {!canBack
}
onClick = {() => wvRef.current?.goBack()}
title = "Back"
type = "button"
  >
  <ArrowLeft size={ 14 } />
    </button>
    < button
className = "p-1.5 rounded hover:bg-bg-2 disabled:opacity-40"
disabled = {!canFwd}
onClick = {() => wvRef.current?.goForward()}
title = "Forward"
type = "button"
  >
  <ArrowRight size={ 14 } />
    </button>
    < button
className = "p-1.5 rounded hover:bg-bg-2"
title = { loading? "Stop": "Reload" }
onClick = {() => (loading ? wvRef.current?.stop() : wvRef.current?.reload())}
type = "button"
  >
  { loading?<X size = { 14 } /> : <RotateCw size={ 14 } />}
</button>
  < form className = "flex-1" onSubmit = {(e) => { e.preventDefault(); go(pending); }}>
    <input
            className="w-full px-2 py-1 text-xs font-mono bg-bg-2 border border-line rounded focus:outline-none focus:border-gold"
value = { pending }
onChange = {(e) => setPending(e.target.value)}
placeholder = "https://… · file:///C:/path/index.html · about:blank"
spellCheck = { false}
  />
  </form>
  < button
className = "px-2 py-1 text-xs flex items-center gap-1 rounded hover:bg-bg-2 text-muted hover:text-gold"
onClick = { openHtml }
title = "Open local .html…"
type = "button"
  >
  <FolderOpen size={ 13 } /> open
    </button>
  < button
className = "p-1.5 rounded hover:bg-bg-2 text-muted hover:text-gold"
title = "Open devtools for this page"
onClick = {() => wvRef.current?.openDevTools()}
type = "button"
  >
  <Bug size={ 14 } />
    </button>
  < button
className = "p-1.5 rounded hover:bg-bg-2 text-muted hover:text-gold"
title = "Open in default browser"
onClick = { openExternal }
type = "button"
  >
  <ExternalLink size={ 14 } />
    </button>
    </div>
  < div className = "flex-1 bg-bg-0" >
    <webview
          ref={ wvRef as any }
src = { HOME_URL }
partition = "persist:grudge-preview"
className = "w-full h-full"
        />
  </div>
  </div>
  );
}
