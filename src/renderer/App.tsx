import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  FolderTree,
  Search as SearchIcon,
  Upload as UploadIcon,
  Link2,
  Fingerprint,
  Store,
  BookOpen,
  Settings as SettingsIcon,
  Power,
  Minimize2,
  LogOut,
  Loader2,
  Hammer,
  Code2,
  Gamepad2,
  Globe,
  ShieldCheck,
  Bot,
  User,
  Boxes,
  Bone,
  Home as HomeIcon,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

const Browser = React.lazy(() => import("./pages/Browser"));
const Search = React.lazy(() => import("./pages/Search"));
const Upload = React.lazy(() => import("./pages/Upload"));
const Request = React.lazy(() => import("./pages/Request"));
const UUID = React.lazy(() => import("./pages/UUID"));
const Library = React.lazy(() => import("./pages/GrudgeStore"));
const FleetLauncher = React.lazy(() => import("./pages/FleetLauncher"));
const Legion = React.lazy(() => import("./pages/Legion"));
const AIWorkspace = React.lazy(() => import("./pages/AIWorkspace"));
const Accounts = React.lazy(() => import("./pages/Accounts"));
const Docs = React.lazy(() => import("./pages/Docs"));
const Settings = React.lazy(() => import("./pages/Settings"));
const Forge3D = React.lazy(() => import("./pages/Forge3D"));
const SkeletonStudio = React.lazy(() => import("./pages/SkeletonStudio"));
const Coder = React.lazy(() => import("./pages/Coder"));
const Preview = React.lazy(() => import("./pages/Preview"));
const AssetLibrary = React.lazy(() => import("./pages/AssetLibrary"));
const StudioHub = React.lazy(() => import("./pages/StudioHub"));

import Login from "./pages/Login";
import StatusBar from "./components/StatusBar";
import ErrorBoundary from "./components/ErrorBoundary";
import { isAdmin, isOpenMode } from "./lib/admin";
import { hydrateFromMain, persistRoute, readMirror } from "./lib/workspace";

type Route =
  | "/browser"
  | "/search"
  | "/upload"
  | "/request"
  | "/uuid"
  | "/library"
  | "/blenderkit"
  | "/studio"
  | "/forge"
  | "/skeleton"
  | "/coder"
  | "/games"
  | "/legion"
  | "/ai"
  | "/accounts"
  | "/preview"
  | "/docs"
  | "/settings";

interface NavEntry {
  route: Route;
  label: string;
  Icon: LucideIcon;
  adminOnly?: boolean;
  /** Primary rail (always visible) vs secondary "More" tools */
  primary?: boolean;
}

/**
 * Primary = daily workflows. Secondary = less frequent tools.
 * Keeps the sidebar short so games/systems stay operable.
 */
const NAV: NavEntry[] = [
  { route: "/studio", label: "Home", Icon: HomeIcon, primary: true },
  { route: "/browser", label: "Assets", Icon: FolderTree, primary: true },
  { route: "/games", label: "Games", Icon: Gamepad2, primary: true },
  { route: "/forge", label: "Forge", Icon: Hammer, primary: true, adminOnly: true },
  { route: "/ai", label: "Agent AI", Icon: Bot, primary: true },
  { route: "/search", label: "Search", Icon: SearchIcon },
  { route: "/upload", label: "Upload", Icon: UploadIcon, adminOnly: true },
  { route: "/request", label: "Request URL", Icon: Link2, adminOnly: true },
  { route: "/library", label: "Store", Icon: Store },
  { route: "/skeleton", label: "Skeleton", Icon: Bone, adminOnly: true },
  { route: "/coder", label: "Coder", Icon: Code2, adminOnly: true },
  { route: "/blenderkit", label: "BlenderKit", Icon: Boxes, adminOnly: true },
  { route: "/legion", label: "Legion Chat", Icon: Bot, adminOnly: true },
  { route: "/preview", label: "Preview", Icon: Globe, adminOnly: true },
  { route: "/uuid", label: "UUID", Icon: Fingerprint },
  { route: "/docs", label: "Docs", Icon: BookOpen },
  { route: "/accounts", label: "Account", Icon: User },
  { route: "/settings", label: "Settings", Icon: SettingsIcon, adminOnly: true },
];

declare global {
  interface Window {
    grudge: any;
  }
}

interface Session {
  signedIn: boolean;
  grudgeId: string | null;
  puterUser: { uuid: string; username: string; email?: string } | null;
  hasToken: boolean;
}

const VALID_ROUTES = new Set<string>(NAV.map((n) => n.route));
/** Legacy routes remapped after shell simplification */
const ROUTE_ALIASES: Record<string, Route> = {
  "/play": "/games",
  "/home": "/studio",
};

const FULL_HEIGHT_ROUTES = new Set<string>([
  "/games",
  "/forge",
  "/skeleton",
  "/coder",
  "/ai",
  "/legion",
  "/preview",
  "/browser",
]);

const APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.9.2";

function resolveRoute(raw: string | undefined | null): Route {
  if (!raw) return "/studio";
  if (ROUTE_ALIASES[raw]) return ROUTE_ALIASES[raw];
  if (VALID_ROUTES.has(raw)) return raw as Route;
  return "/studio";
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => resolveRoute(readMirror().route));
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreOpen, setMoreOpen] = useState(() => {
    const saved = readMirror().route;
    const r = resolveRoute(saved);
    const entry = NAV.find((n) => n.route === r);
    return Boolean(entry && !entry.primary);
  });

  const refreshSession = useCallback(async () => {
    try {
      const s: Session = await window.grudge.auth.getSession();
      setSession(s);
    } catch (err: unknown) {
      console.error("auth.getSession failed", err);
      setSession({ signedIn: false, grudgeId: null, puterUser: null, hasToken: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    void hydrateFromMain().then((snap) => {
      if (snap?.route) setRoute(resolveRoute(snap.route));
    });
    const off = window.grudge?.onNav?.((r: string) => setRoute(resolveRoute(r)));
    void (async () => {
      try {
        const s = await window.grudge.auth.getSession();
        if (s?.signedIn && isAdmin(s)) {
          await window.grudge.ollama?.ensure?.({ agentic: true, reason: "renderer-admin-session" });
        } else {
          await window.grudge.ollama?.ensure?.({ agentic: false, reason: "renderer-open" });
        }
      } catch {
        /* main process also ensures on open */
      }
    })();
    return () => off?.();
  }, [refreshSession]);

  useEffect(() => {
    void persistRoute(route);
  }, [route]);

  async function signOut() {
    if (!confirm("Sign out of Grudge?")) return;
    try {
      await window.grudge.auth.clearSession();
      toast.success("Signed out");
      void refreshSession();
    } catch (err: unknown) {
      toast.error("Sign-out failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const admin = session ? isAdmin(session) : false;

  const { primaryNav, moreNav } = useMemo(() => {
    const visible = NAV.filter((n) => admin || !n.adminOnly);
    return {
      primaryNav: visible.filter((n) => n.primary),
      moreNav: visible.filter((n) => !n.primary),
    };
  }, [admin]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-muted gap-3">
        <Loader2 size={28} className="animate-spin text-gold" />
        <span className="text-xs">Checking session…</span>
      </div>
    );
  }

  if (!session?.signedIn) {
    return <Login onSignedIn={refreshSession} />;
  }

  const currentEntry = NAV.find((n) => n.route === route);
  if (currentEntry?.adminOnly && !admin) {
    queueMicrotask(() => setRoute("/studio"));
  }

  const go = (r: Route) => {
    setRoute(r);
    const entry = NAV.find((n) => n.route === r);
    if (entry && !entry.primary) setMoreOpen(true);
  };

  const fullHeight = FULL_HEIGHT_ROUTES.has(route);

  const suspenseFallback = (
    <div className="flex items-center justify-center h-full text-muted gap-2 min-h-[200px]">
      <Loader2 size={20} className="animate-spin text-gold" />
      <span className="text-xs">Loading…</span>
    </div>
  );

  return (
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
                </>
              ) : (
                <span>Assets · Games · AI</span>
              )}
            </div>
          </div>
        </div>

        <div
          className="px-3 py-2 mb-2 text-xs border border-line rounded bg-bg-2/40"
          title={session.grudgeId ?? ""}
        >
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
          <div className="text-muted truncate font-mono text-[10px]">
            {session.grudgeId ?? "no grudge id"}
          </div>
          {isOpenMode() && (
            <div
              className="text-[9px] text-muted/70 mt-1"
              title="No VITE_ADMIN_* allowlist configured in this build"
            >
              open-mode build
            </div>
          )}
        </div>

        <nav className="sidebar-nav-scroll">
          <div className="nav-group">
            <div className="nav-group-label">Work</div>
            {primaryNav.map((n) => (
              <button
                key={n.route}
                type="button"
                className={"nav-item" + (route === n.route ? " active" : "")}
                onClick={() => go(n.route)}
              >
                <span className="nav-icon flex items-center justify-center">
                  <n.Icon size={16} />
                </span>
                <span className="nav-label">{n.label}</span>
              </button>
            ))}
          </div>

          {moreNav.length > 0 && (
            <div className="nav-group">
              <button
                type="button"
                className="nav-group-toggle"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
              >
                <span className="nav-group-label mb-0">More tools</span>
                {moreOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              {moreOpen &&
                moreNav.map((n) => (
                  <button
                    key={n.route}
                    type="button"
                    className={"nav-item nav-item--sub" + (route === n.route ? " active" : "")}
                    onClick={() => go(n.route)}
                  >
                    <span className="nav-icon flex items-center justify-center">
                      <n.Icon size={15} />
                    </span>
                    <span className="nav-label">{n.label}</span>
                  </button>
                ))}
            </div>
          )}
        </nav>

        <div className="sidebar-footer flex items-center gap-2">
          <span className="version flex-1">v{APP_VERSION}</span>
          <button type="button" title="Sign out" className="text-muted hover:text-gold" onClick={signOut}>
            <LogOut size={14} />
          </button>
          <button
            type="button"
            title="Hide to tray"
            className="text-muted hover:text-gold"
            onClick={() => window.grudge?.app?.hide?.()}
          >
            <Minimize2 size={14} />
          </button>
          <button
            type="button"
            title="Quit Grudge Studio"
            className="text-muted hover:text-danger"
            onClick={() => {
              if (confirm("Quit Grudge Studio?")) window.grudge?.app?.quit?.();
            }}
          >
            <Power size={14} />
          </button>
        </div>
      </aside>

      <main className={"content flex flex-col" + (fullHeight ? " content--full" : "")}>
        <div
          className={
            "flex-1 min-h-0 " + (fullHeight ? "overflow-hidden flex flex-col" : "overflow-auto")
          }
        >
          <ErrorBoundary>
            <React.Suspense fallback={suspenseFallback}>
              {route === "/studio" && (
                <StudioHub
                  onNavigate={(r) => go(resolveRoute(r))}
                  admin={admin}
                  username={session.puterUser?.username}
                />
              )}
              {route === "/browser" && <Browser />}
              {route === "/search" && <Search />}
              {route === "/upload" && <Upload />}
              {route === "/request" && <Request />}
              {route === "/uuid" && <UUID />}
              {route === "/library" && <Library />}
              {route === "/blenderkit" && <AssetLibrary />}
              {route === "/forge" && <Forge3D />}
              {route === "/skeleton" && <SkeletonStudio />}
              {route === "/coder" && <Coder />}
              {route === "/games" && <FleetLauncher admin={admin} />}
              {route === "/ai" && <AIWorkspace />}
              {route === "/accounts" && <Accounts />}
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
  );
}
