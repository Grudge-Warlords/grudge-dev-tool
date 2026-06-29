import React, { useEffect, useState, useCallback } from "react";
import {
  FolderTree, Search as SearchIcon, Upload as UploadIcon, Link2,
  Fingerprint, Store, BookOpen, Settings as SettingsIcon,
  Power, Minimize2, LogOut, Loader2, Hammer, Code2, Gamepad2, Globe, ShieldCheck, Bot, Cpu,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
// Lazy-loaded pages — keeps first-paint fast (the user only ever opens 1
// page at a time, so loading 8 chunks up-front is wasted work).
const Browser = React.lazy(() => import("./pages/Browser"));
const Search = React.lazy(() => import("./pages/Search"));
const Upload = React.lazy(() => import("./pages/Upload"));
const Request = React.lazy(() => import("./pages/Request"));
const UUID = React.lazy(() => import("./pages/UUID"));
const Library = React.lazy(() => import("./pages/GrudgeStore"));
const FleetLauncher = React.lazy(() => import("./pages/FleetLauncher"));
const Legion = React.lazy(() => import("./pages/Legion"));
const Docs = React.lazy(() => import("./pages/Docs"));
const Settings = React.lazy(() => import("./pages/Settings"));
const Forge3D = React.lazy(() => import("./pages/Forge3D"));
const Coder = React.lazy(() => import("./pages/Coder"));
const GrudgeEngine = React.lazy(() => import("./pages/GrudgeEngine"));

const Preview = React.lazy(() => import("./pages/Preview"));
const AssetLibrary = React.lazy(() => import("./pages/AssetLibrary"));
import Login from "./pages/Login";    // not lazy — always rendered first
import StatusBar from "./components/StatusBar";
import ErrorBoundary from "./components/ErrorBoundary";
import GrudaChainOverlay from "./components/GrudaChainOverlay";
import { isAdmin, isOpenMode } from "./lib/admin";
import { hydrateFromMain, persistRoute, readMirror } from "./lib/workspace";

type Route =
  | "/browser" | "/search" | "/upload" | "/request"
  | "/uuid" | "/library" | "/blenderkit" | "/forge" | "/coder" | "/engine" | "/games" | "/legion"
  | "/preview" | "/docs" | "/settings";

interface NavEntry {
  route: Route;
  label: string;
  Icon: LucideIcon;
  /** When true, hidden from non-admin sessions. */
  adminOnly?: boolean;
}

const NAV: NavEntry[] = [
  { route: "/browser", label: "Browser", Icon: FolderTree },
  { route: "/search", label: "Search", Icon: SearchIcon },
  { route: "/upload", label: "Upload", Icon: UploadIcon, adminOnly: true },
  { route: "/request", label: "Request URL", Icon: Link2, adminOnly: true },
  { route: "/uuid", label: "UUID", Icon: Fingerprint },
  { route: "/library", label: "Store", Icon: Store },
  { route: "/blenderkit", label: "BlenderKit", Icon: BookOpen },
  { route: "/games", label: "Games", Icon: Gamepad2 },
  { route: "/engine", label: "Grudge Engine", Icon: Cpu },
  { route: "/legion", label: "GrudaChain", Icon: Bot },
  { route: "/forge", label: "Forge 3D", Icon: Hammer, adminOnly: true },
  { route: "/coder", label: "Coder", Icon: Code2, adminOnly: true },
  { route: "/preview", label: "Preview", Icon: Globe, adminOnly: true },
  { route: "/docs", label: "Docs", Icon: BookOpen },
  { route: "/settings", label: "Settings", Icon: SettingsIcon, adminOnly: true },
];

declare global { interface Window { grudge: any } }

interface Session {
  signedIn: boolean;
  grudgeId: string | null;
  puterUser: { uuid: string; username: string; email?: string } | null;
  hasToken: boolean;
}

const VALID_ROUTES = new Set<string>([
  "/browser", "/search", "/upload", "/request", "/uuid", "/library", "/blenderkit", "/forge",
  "/coder", "/engine", "/games", "/legion", "/preview", "/docs", "/settings",
]);

const FULL_HEIGHT_ROUTES = new Set<string>(["/games", "/legion", "/forge", "/engine"]);

function isForgePopoutHash(): boolean {
  const h = (window.location.hash || "").replace(/^#\/?/, "");
  return h === "forge-popout" || h === "/forge-popout";
}

export default function App() {
  const [forgePopout] = useState(() => isForgePopoutHash());
  const [route, setRoute] = useState<Route>(() => {
    const saved = readMirror().route;
    return (saved && VALID_ROUTES.has(saved) ? saved : "/browser") as Route;
  });
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [grudaOpen, setGrudaOpen] = useState(false);

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
    hydrateFromMain().then((snap) => {
      if (snap?.route && VALID_ROUTES.has(snap.route)) {
        setRoute(snap.route as Route);
      }
    });
    const off = window.grudge?.onNav?.((r: Route) => setRoute(r));
    const offGruda = window.grudge?.grudachain?.onToggle?.(() => setGrudaOpen((v) => !v));
    return () => {
      off?.();
      offGruda?.();
    };
  }, [refreshSession]);

  useEffect(() => {
    persistRoute(route);
  }, [route]);

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
      <div className= "flex flex-col items-center justify-center h-screen text-muted gap-3" >
      <Loader2 size={ 28 } className = "animate-spin text-gold" />
        <span className="text-xs" > Checking session…</span>
          </div>
    );
  }

  // ---- not signed in: gate the entire UI behind Login ----
  if (!session?.signedIn && !forgePopout) {
    return <Login onSignedIn={ refreshSession } />;
  }

  if (forgePopout) {
    return (
      <div className="h-screen w-screen bg-bg-0 overflow-hidden">
        <ErrorBoundary>
          <React.Suspense fallback={<div className="flex items-center justify-center h-full text-muted"><Loader2 size={20} className="animate-spin text-gold" /></div>}>
            <Forge3D />
          </React.Suspense>
        </ErrorBoundary>
      </div>
    );
  }

  if (!session) {
    return <Login onSignedIn={refreshSession} />;
  }

  const admin = isAdmin(session);
  const visibleNav = NAV.filter((n) => admin || !n.adminOnly);
  // If we land on an admin-only route without admin (e.g., session changed),
  // bounce to the first visible route on the next microtask.
  const currentEntry = NAV.find((n) => n.route === route);
  if (currentEntry?.adminOnly && !admin) {
    queueMicrotask(() => setRoute(visibleNav[0]?.route ?? "/browser"));
  }

  return (
    <>
    <GrudaChainOverlay open={grudaOpen} onClose={() => setGrudaOpen(false)} />
    <div className= "app" >
    <aside className="sidebar" >
      <div className="brand" >
        <img src="./logo-256.png" alt = "Grudge" width = { 36} height = { 36} />
          <div>
          <div className="brand-title" > Grudge Studio Forge </div>
            < div className = "brand-sub flex items-center gap-1.5" >
            {
              admin?(
                <>
              <ShieldCheck size={ 11 } className = "text-gold" />
                <span className="text-gold" > Admin </span>
                  < span className = "opacity-60" >· Forge · Coder · Assets </span>
                    </>
              ) : (
    <span>Forge · Coder · Assets </span>
              )
}
</div>
  </div>
  </div>
  < div className = "px-3 py-2 mb-2 text-xs border border-line rounded bg-bg-2/40" title = { session.grudgeId ?? "" } >
    <div className="flex items-center gap-1.5" >
      <span className="text-gold font-semibold truncate flex-1" > { session.puterUser?.username ?? "unknown" } </span>
{
  admin && (
    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-gold/15 text-gold border border-gold/30" >
      ADMIN
      </span>
                  )
}
</div>
  < div className = "text-muted truncate font-mono text-[10px]" > { session.grudgeId ?? "no grudge id" } </div>
{
  isOpenMode() && (
    <div className="text-[9px] text-muted/70 mt-1" title = "No VITE_ADMIN_* allowlist configured in this build" >
      { "open-mode build"}
      </div>
                )
}
</div>
  <nav>
{
  visibleNav.map((n) => (
    <button
              key= { n.route }
              className = { "nav-item" + (route === n.route ? " active" : "") }
              onClick = {() => setRoute(n.route)}
            >
  <span className="nav-icon flex items-center justify-center" >
    <n.Icon size={ 16 } />
      </span>
      < span className = "nav-label" > { n.label } </span>
        </button>
          ))
}
</nav>
  < div className = "sidebar-footer flex items-center gap-2" >
    <span className="version flex-1" > v0.6.0 </span>
      < button
title = "Sign out"
className = "text-muted hover:text-gold"
onClick = { signOut }
  > <LogOut size={ 14 } /></button >
    <button
            title="Hide to tray"
className = "text-muted hover:text-gold"
onClick = {() => window.grudge?.app?.hide?.()}
          > <Minimize2 size={ 14 } /></button >
  <button
            title="Quit Grudge Dev Tool"
className = "text-muted hover:text-danger"
onClick = {() => {
  if (confirm("Quit Grudge Dev Tool?")) window.grudge?.app?.quit?.();
}}
          > <Power size={ 14 } /></button >
  </div>
  </aside>
  < main className = "content flex flex-col" >
    <div className={`flex-1 min-h-0 ${FULL_HEIGHT_ROUTES.has(route) ? "overflow-hidden flex flex-col" : "overflow-auto"}`}>
    {/* Per-page boundary so a buggy page doesn't kill the shell.
              Suspense fallback handles the lazy chunk-load gap. */}
      < ErrorBoundary >
      <React.Suspense fallback={ <div className="flex items-center justify-center h-full text-muted gap-2" > <Loader2 size={ 20 } className = "animate-spin text-gold" /> <span className="text-xs" > Loading…</span></div >}>
        { route === "/browser" && <Browser />}
{ route === "/search" && <Search /> }
{ route === "/upload" && <Upload /> }
{ route === "/request" && <Request /> }
{ route === "/uuid" && <UUID /> }
{ route === "/library" && <Library /> }
{ route === "/blenderkit" && <AssetLibrary /> }
{ route === "/forge" && <Forge3D /> }
{ route === "/coder" && <Coder /> }
{ route === "/engine" && <GrudgeEngine /> }
{ route === "/games" && <FleetLauncher /> }
{ route === "/legion" && <Legion /> }
{ route === "/preview" && <Preview /> }
{ route === "/docs" && <Docs /> }
{ route === "/settings" && <Settings /> }
</React.Suspense>
  </ErrorBoundary>
  </div>
  < StatusBar admin = { admin } />
    </main>
    </div>
    </>
  );
}
