import React, { useEffect, useState, useCallback } from "react";
import {
  FolderTree, Search as SearchIcon, Upload as UploadIcon, Link2,
  Fingerprint, Store, BookOpen, Settings as SettingsIcon,
  Power, Minimize2, LogOut, Loader2, Hammer, Code2, Gamepad2, Globe, ShieldCheck, Bot, Cpu,
  Home as HomeIcon, MessageCircle, Box, FolderKanban, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

const Home = React.lazy(() => import("./pages/Home"));
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
const Forge = React.lazy(() => import("./pages/Forge"));
const Forge3D = React.lazy(() => import("./pages/Forge3D"));
const Coder = React.lazy(() => import("./pages/Coder"));
const GrudgeEngine = React.lazy(() => import("./pages/GrudgeEngine"));
const Treaty = React.lazy(() => import("./pages/Treaty"));
const AssetStudio = React.lazy(() => import("./pages/AssetStudio"));
const Projects = React.lazy(() => import("./pages/Projects"));
const Preview = React.lazy(() => import("./pages/Preview"));

import Login from "./pages/Login";
import StatusBar from "./components/StatusBar";
import ErrorBoundary from "./components/ErrorBoundary";
import GrudaChainOverlay from "./components/GrudaChainOverlay";
import { isAdmin, isOpenMode } from "./lib/admin";
import { hydrateFromMain, persistRoute, readMirror } from "./lib/workspace";

type Route =
  | "/home" | "/browser" | "/search" | "/upload" | "/request" | "/assets-3d"
  | "/projects" | "/uuid" | "/library" | "/forge" | "/coder" | "/engine" | "/games" | "/legion"
  | "/treaty" | "/preview" | "/docs" | "/settings";

interface NavEntry {
  route: Route;
  label: string;
  Icon: LucideIcon;
  adminOnly?: boolean;
  group?: string;
}

const NAV: NavEntry[] = [
  { route: "/home", label: "Home", Icon: HomeIcon, group: "Studio" },
  { route: "/projects", label: "Projects", Icon: FolderKanban, group: "Studio" },
  { route: "/browser", label: "Browser", Icon: FolderTree, group: "Assets" },
  { route: "/search", label: "Search", Icon: SearchIcon, group: "Assets" },
  { route: "/upload", label: "Upload", Icon: UploadIcon, adminOnly: true, group: "Assets" },
  { route: "/request", label: "Request URL", Icon: Link2, group: "Assets" },
  { route: "/library", label: "Store", Icon: Store, group: "Assets" },
  { route: "/assets-3d", label: "3D Studio", Icon: Box, group: "Assets" },
  { route: "/forge", label: "Forge", Icon: Hammer, group: "Create" },
  { route: "/coder", label: "Coder", Icon: Code2, group: "Create" },
  { route: "/engine", label: "Engine", Icon: Cpu, group: "Create" },
  { route: "/games", label: "Games", Icon: Gamepad2, group: "Run" },
  { route: "/treaty", label: "Treaty", Icon: MessageCircle, group: "Run" },
  { route: "/legion", label: "Legion", Icon: Bot, group: "Run" },
  { route: "/preview", label: "Preview", Icon: Globe, group: "Run" },
  { route: "/uuid", label: "UUID", Icon: Fingerprint, group: "System" },
  { route: "/docs", label: "Docs", Icon: BookOpen, group: "System" },
  { route: "/settings", label: "Settings", Icon: SettingsIcon, adminOnly: true, group: "System" },
];

declare global { interface Window { grudge: any } }

interface Session {
  signedIn: boolean;
  grudgeId: string | null;
  puterUser: { uuid: string; username: string; email?: string } | null;
  hasToken: boolean;
}

const VALID_ROUTES = new Set<string>([
  "/home", "/projects", "/browser", "/search", "/upload", "/request", "/assets-3d", "/uuid", "/library", "/forge",
  "/coder", "/engine", "/games", "/legion", "/treaty", "/preview", "/docs", "/settings",
]);

const FULL_HEIGHT_ROUTES = new Set<string>([
  "/games", "/legion", "/forge", "/engine", "/coder", "/treaty", "/assets-3d", "/projects",
]);

function isForgePopoutHash(): boolean {
  const h = (window.location.hash || "").replace(/^#\/?/, "");
  return h === "forge-popout" || h === "/forge-popout";
}

function groupVisibleNav(entries: NavEntry[]): { group: string; items: NavEntry[] }[] {
  const order: string[] = [];
  const map = new Map<string, NavEntry[]>();
  for (const e of entries) {
    const g = e.group ?? "Studio";
    if (!map.has(g)) {
      map.set(g, []);
      order.push(g);
    }
    map.get(g)!.push(e);
  }
  return order.map((group) => ({ group, items: map.get(group)! }));
}

export default function App() {
  const [forgePopout] = useState(() => isForgePopoutHash());
  const [route, setRoute] = useState<Route>(() => {
    const saved = readMirror().route;
    if (saved === "/blenderkit" || saved === "/library/blenderkit") return "/browser";
    return (saved && VALID_ROUTES.has(saved) ? saved : "/home") as Route;
  });
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [grudaOpen, setGrudaOpen] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      const s: Session = await window.grudge.auth.getSession();
      setSession(s);
      // Keep Forge + Coder webviews on the same Grudge identity — one Studio
      // login must cover every embedded module without a second sign-in.
      if (s.signedIn) {
        void window.grudge?.auth?.syncStudioSso?.().catch(() => { /* non-fatal */ });
      }
    } catch (err: any) {
      console.error("auth.getSession failed", err);
      setSession({ signedIn: false, grudgeId: null, puterUser: null, hasToken: false });
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-sync SSO whenever user opens module embeds (Forge/Coder/Preview)
  useEffect(() => {
    if (!session?.signedIn) return;
    if (route === "/forge" || route === "/coder" || route === "/preview" || route === "/treaty") {
      void window.grudge?.auth?.syncStudioSso?.().catch(() => { /* non-fatal */ });
    }
  }, [route, session?.signedIn]);

  useEffect(() => {
    refreshSession();
    hydrateFromMain().then((snap) => {
      // BlenderKit tab removed — never restore that route.
      if (snap?.route === "/blenderkit" || snap?.route === "/library/blenderkit") {
        setRoute("/browser");
        return;
      }
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
    if (!confirm("Sign out of Grudge Studio?")) return;
    try {
      await window.grudge.auth.clearSession();
      toast.success("Signed out");
      refreshSession();
    } catch (err: any) {
      toast.error("Sign-out failed", { description: err?.message ?? String(err) });
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-muted gap-3">
        <Loader2 size={28} className="animate-spin text-gold" />
        <span className="text-xs">Checking session…</span>
      </div>
    );
  }

  if (!session?.signedIn && !forgePopout) {
    return <Login onSignedIn={refreshSession} />;
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
  const navGroups = groupVisibleNav(visibleNav);
  const currentEntry = NAV.find((n) => n.route === route);
  if (currentEntry?.adminOnly && !admin) {
    queueMicrotask(() => setRoute(visibleNav[0]?.route ?? "/home"));
  }

  const suspenseFallback = (
    <div className="flex items-center justify-center h-full text-muted gap-2">
      <Loader2 size={20} className="animate-spin text-gold" />
      <span className="text-xs">Loading…</span>
    </div>
  );

  return (
    <>
      <GrudaChainOverlay open={grudaOpen} onClose={() => setGrudaOpen(false)} />
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <img src="./logo-256.png" alt="Grudge" width={36} height={36} />
            <div>
              <div className="brand-title">Grudge Studio</div>
              <div className="brand-sub flex items-center gap-1.5">
                {admin ? (
                  <>
                    <ShieldCheck size={11} className="text-gold" />
                    <span className="text-gold">Admin</span>
                    <span className="opacity-60">· Truth · Assets · Forge · Coder</span>
                  </>
                ) : (
                  <span>Truth · Assets · Forge · Coder</span>
                )}
              </div>
            </div>
          </div>

          <div className="px-3 py-2 mb-2 text-xs border border-line rounded bg-bg-2/40" title={session.grudgeId ?? ""}>
            <div className="flex items-center gap-1.5">
              <span className="text-gold font-semibold truncate flex-1">
                {session.puterUser?.username ?? "unknown"}
              </span>
              {admin && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-gold/15 text-gold border border-gold/30">
                  ADMIN
                </span>
              )}
            </div>
            <div className="text-muted truncate font-mono text-[10px]">{session.grudgeId ?? "no grudge id"}</div>
            {isOpenMode() && (
              <div className="text-[9px] text-muted/70 mt-1" title="No VITE_ADMIN_* allowlist configured in this build">
                open-mode build
              </div>
            )}
          </div>

          <nav className="sidebar-nav-scroll">
            {navGroups.map(({ group, items }) => (
              <div key={group} className="nav-group">
                <div className="nav-group-label">{group}</div>
                {items.map((n) => (
                  <button
                    key={n.route}
                    type="button"
                    className={"nav-item" + (route === n.route ? " active" : "")}
                    onClick={() => setRoute(n.route)}
                  >
                    <span className="nav-icon flex items-center justify-center">
                      <n.Icon size={16} />
                    </span>
                    <span className="nav-label">{n.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="sidebar-footer flex items-center gap-2">
            <span className="version flex-1">v{__APP_VERSION__}</span>
            <button title="Sign out" className="text-muted hover:text-gold" type="button" onClick={signOut}>
              <LogOut size={14} />
            </button>
            <button
              title="Hide to tray"
              className="text-muted hover:text-gold"
              type="button"
              onClick={() => window.grudge?.app?.hide?.()}
            >
              <Minimize2 size={14} />
            </button>
            <button
              title="Quit Grudge Studio"
              className="text-muted hover:text-danger"
              type="button"
              onClick={() => {
                if (confirm("Quit Grudge Studio?")) window.grudge?.app?.quit?.();
              }}
            >
              <Power size={14} />
            </button>
          </div>
        </aside>

        <main className={"content flex flex-col" + (FULL_HEIGHT_ROUTES.has(route) ? " content--full" : "")}>
          <div className={`flex-1 min-h-0 ${FULL_HEIGHT_ROUTES.has(route) ? "overflow-hidden flex flex-col" : "overflow-auto"}`}>
            <ErrorBoundary>
              <React.Suspense fallback={suspenseFallback}>
                {route === "/home" && (
                  <Home
                    onNavigate={(r) => setRoute(r as Route)}
                    admin={admin}
                    username={session.puterUser?.username}
                    grudgeId={session.grudgeId}
                  />
                )}
                {route === "/projects" && <Projects />}
                {route === "/browser" && <Browser />}
                {route === "/search" && <Search />}
                {route === "/upload" && <Upload />}
                {route === "/request" && <Request />}
                {route === "/uuid" && <UUID />}
                {route === "/library" && <Library />}
                {route === "/assets-3d" && <AssetStudio />}
                {route === "/forge" && <Forge />}
                {route === "/coder" && <Coder />}
                {route === "/engine" && <GrudgeEngine />}
                {route === "/games" && <FleetLauncher />}
                {route === "/treaty" && <Treaty />}
                {route === "/legion" && <Legion />}
                {route === "/preview" && <Preview />}
                {route === "/docs" && <Docs />}
                {route === "/settings" && <Settings />}
              </React.Suspense>
            </ErrorBoundary>
          </div>
          <StatusBar admin={admin} />
        </main>
      </div>
    </>
  );
}
