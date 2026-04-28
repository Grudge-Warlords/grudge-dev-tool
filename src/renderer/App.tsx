import React, { useEffect, useState, useCallback } from "react";
import {
  FolderTree, Search as SearchIcon, Upload as UploadIcon, Link2,
  Fingerprint, Palette, BookOpen, Settings as SettingsIcon,
  Power, Minimize2, LogOut, Loader2, Hammer,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
// Lazy-loaded pages — keeps first-paint fast (the user only ever opens 1
// page at a time, so loading 8 chunks up-front is wasted work).
const Browser  = React.lazy(() => import("./pages/Browser"));
const Search   = React.lazy(() => import("./pages/Search"));
const Upload   = React.lazy(() => import("./pages/Upload"));
const Request  = React.lazy(() => import("./pages/Request"));
const UUID     = React.lazy(() => import("./pages/UUID"));
const Library  = React.lazy(() => import("./pages/AssetLibrary"));
const Docs     = React.lazy(() => import("./pages/Docs"));
const Settings = React.lazy(() => import("./pages/Settings"));
const Forge3D  = React.lazy(() => import("./pages/Forge3D"));
import Login from "./pages/Login";    // not lazy — always rendered first
import StatusBar from "./components/StatusBar";
import ErrorBoundary from "./components/ErrorBoundary";

type Route =
  | "/browser" | "/search" | "/upload" | "/request"
  | "/uuid" | "/library" | "/forge" | "/docs" | "/settings";

const NAV: Array<{ route: Route; label: string; Icon: LucideIcon }> = [
  { route: "/browser",  label: "Browser",     Icon: FolderTree },
  { route: "/search",   label: "Search",      Icon: SearchIcon },
  { route: "/upload",   label: "Upload",      Icon: UploadIcon },
  { route: "/request",  label: "Request URL", Icon: Link2 },
  { route: "/uuid",     label: "UUID",        Icon: Fingerprint },
  { route: "/library",  label: "BlenderKit",  Icon: Palette },
  { route: "/forge",    label: "Forge 3D",    Icon: Hammer },
  { route: "/docs",     label: "Docs",        Icon: BookOpen },
  { route: "/settings", label: "Settings",    Icon: SettingsIcon },
];

declare global { interface Window { grudge: any } }

interface Session {
  signedIn: boolean;
  grudgeId: string | null;
  puterUser: { uuid: string; username: string; email?: string } | null;
  hasToken: boolean;
}

export default function App() {
  const [route, setRoute] = useState<Route>("/browser");
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const s: Session = await window.grudge.auth.getSession();
      setSession(s);
    } catch (err: any) {
      console.error("auth.getSession failed", err);
      setSession({ signedIn: false, grudgeId: null, puterUser: null, hasToken: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
    const off = window.grudge?.onNav?.((r: Route) => setRoute(r));
    return () => off?.();
  }, [refreshSession]);

  async function signOut() {
    if (!confirm("Sign out of Grudge?")) return;
    try {
      await window.grudge.auth.clearSession();
      toast.success("Signed out");
      refreshSession();
    } catch (err: any) {
      toast.error("Sign-out failed", { description: err?.message ?? String(err) });
    }
  }

  // ---- loading splash ----
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-muted gap-3">
        <Loader2 size={28} className="animate-spin text-gold" />
        <span className="text-xs">Checking session…</span>
      </div>
    );
  }

  // ---- not signed in: gate the entire UI behind Login ----
  if (!session?.signedIn) {
    return <Login onSignedIn={refreshSession} />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="./logo-256.png" alt="Grudge" width={36} height={36} />
          <div>
            <div className="brand-title">Grudge Dev Tool</div>
            <div className="brand-sub">Object Storage · UUID · BlenderKit</div>
          </div>
        </div>
        <div className="px-3 py-2 mb-2 text-xs border border-line rounded bg-bg-2/40" title={session.grudgeId ?? ""}>
          <div className="text-gold font-semibold truncate">{session.puterUser?.username ?? "unknown"}</div>
          <div className="text-muted truncate font-mono text-[10px]">{session.grudgeId ?? "no grudge id"}</div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.route}
              className={"nav-item" + (route === n.route ? " active" : "")}
              onClick={() => setRoute(n.route)}
            >
              <span className="nav-icon flex items-center justify-center">
                <n.Icon size={16} />
              </span>
              <span className="nav-label">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer flex items-center gap-2">
          <span className="version flex-1">v0.1.6</span>
          <button
            title="Sign out"
            className="text-muted hover:text-gold"
            onClick={signOut}
          ><LogOut size={14} /></button>
          <button
            title="Hide to tray"
            className="text-muted hover:text-gold"
            onClick={() => window.grudge?.app?.hide?.()}
          ><Minimize2 size={14} /></button>
          <button
            title="Quit Grudge Dev Tool"
            className="text-muted hover:text-danger"
            onClick={() => {
              if (confirm("Quit Grudge Dev Tool?")) window.grudge?.app?.quit?.();
            }}
          ><Power size={14} /></button>
        </div>
      </aside>
      <main className="content flex flex-col">
        <div className="flex-1 overflow-auto">
          {/* Per-page boundary so a buggy page doesn't kill the shell.
              Suspense fallback handles the lazy chunk-load gap. */}
          <ErrorBoundary>
            <React.Suspense fallback={<div className="flex items-center justify-center h-full text-muted gap-2"><Loader2 size={20} className="animate-spin text-gold" /><span className="text-xs">Loading…</span></div>}>
              {route === "/browser" && <Browser />}
              {route === "/search" && <Search />}
              {route === "/upload" && <Upload />}
              {route === "/request" && <Request />}
              {route === "/uuid" && <UUID />}
              {route === "/library" && <Library />}
              {route === "/forge" && <Forge3D />}
              {route === "/docs" && <Docs />}
              {route === "/settings" && <Settings />}
            </React.Suspense>
          </ErrorBoundary>
        </div>
        <StatusBar />
      </main>
    </div>
  );
}
