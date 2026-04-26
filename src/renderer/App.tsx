import React, { useEffect, useState } from "react";
import {
  FolderTree, Search as SearchIcon, Upload as UploadIcon, Link2,
  Fingerprint, Palette, BookOpen, Settings as SettingsIcon,
  Power, Minimize2,
  type LucideIcon,
} from "lucide-react";
import Browser from "./pages/Browser";
import Search from "./pages/Search";
import Upload from "./pages/Upload";
import Request from "./pages/Request";
import UUID from "./pages/UUID";
import Library from "./pages/AssetLibrary";
import Docs from "./pages/Docs";
import Settings from "./pages/Settings";
import StatusBar from "./components/StatusBar";

type Route =
  | "/browser" | "/search" | "/upload" | "/request"
  | "/uuid" | "/library" | "/docs" | "/settings";

const NAV: Array<{ route: Route; label: string; Icon: LucideIcon }> = [
  { route: "/browser",  label: "Browser",     Icon: FolderTree },
  { route: "/search",   label: "Search",      Icon: SearchIcon },
  { route: "/upload",   label: "Upload",      Icon: UploadIcon },
  { route: "/request",  label: "Request URL", Icon: Link2 },
  { route: "/uuid",     label: "UUID",        Icon: Fingerprint },
  { route: "/library",  label: "BlenderKit",  Icon: Palette },
  { route: "/docs",     label: "Docs",        Icon: BookOpen },
  { route: "/settings", label: "Settings",    Icon: SettingsIcon },
];

declare global { interface Window { grudge: any } }

export default function App() {
  const [route, setRoute] = useState<Route>("/browser");

  useEffect(() => {
    const off = window.grudge?.onNav?.((r: Route) => setRoute(r));
    return () => off?.();
  }, []);

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
          {route === "/browser" && <Browser />}
          {route === "/search" && <Search />}
          {route === "/upload" && <Upload />}
          {route === "/request" && <Request />}
          {route === "/uuid" && <UUID />}
          {route === "/library" && <Library />}
          {route === "/docs" && <Docs />}
          {route === "/settings" && <Settings />}
        </div>
        <StatusBar />
      </main>
    </div>
  );
}
