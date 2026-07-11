import React, { useCallback, useEffect, useState } from "react";
import {
  Hammer, Code2, FolderTree, ShieldCheck, Loader2, RefreshCw,
  ExternalLink, Store, Cpu, Gamepad2, BookOpen, Wifi, WifiOff,
} from "lucide-react";
import { FLEET_URLS, STUDIO_MODULE_URLS, TRUTH_HEALTH_THRESHOLD } from "../../shared/fleet";

type NavTarget =
  | "/forge" | "/coder" | "/browser" | "/search" | "/library"
  | "/engine" | "/games" | "/docs" | "/settings";

interface Props {
  onNavigate: (route: NavTarget) => void;
  admin?: boolean;
  username?: string | null;
  grudgeId?: string | null;
}

interface ConnSnap {
  reachable?: boolean;
  online?: boolean;
  apiBaseUrl?: string;
  latencyMs?: number | null;
  truthScore?: number | null;
  error?: string | null;
}

const HOST_ROWS: { label: string; url: string; role: string }[] = [
  { label: "Fleet client", url: FLEET_URLS.client, role: "API base (ONE TRUTH)" },
  { label: "Auth", url: FLEET_URLS.auth, role: "Identity / SSO" },
  { label: "Assets CDN", url: FLEET_URLS.assets, role: "Binary GLBs · packs" },
  { label: "Coder", url: STUDIO_MODULE_URLS.coder, role: "Agentic IDE module" },
  { label: "Forge", url: STUDIO_MODULE_URLS.forge, role: "Scene editor module" },
];

export default function Home({ onNavigate, admin, username, grudgeId }: Props) {
  const [conn, setConn] = useState<ConnSnap | null>(null);
  const [probing, setProbing] = useState(false);

  const refresh = useCallback(async () => {
    setProbing(true);
    try {
      const s = await window.grudge?.connectivity?.get?.();
      if (s) setConn(s);
    } catch { /* ignore */ }
    finally { setProbing(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.grudge?.connectivity?.onChange?.((s: ConnSnap) => setConn(s));
    return () => { off?.(); };
  }, [refresh]);

  const score = conn?.truthScore ?? null;
  const healthy = score != null && score >= TRUTH_HEALTH_THRESHOLD;
  const scoreColor =
    score == null ? "text-muted"
      : healthy ? "text-green-400"
        : score >= 50 ? "text-gold"
          : "text-red-400";

  return (
    <div className="home-page">
      <header className="home-hero">
        <div>
          <p className="home-kicker">Canonical hub</p>
          <h1 className="page-title">Grudge Studio</h1>
          <p className="muted text-sm max-w-2xl mt-1">
            One app for fleet truth, assets, Forge, and Coder.
            Browse the object store, author 3D, and code game modules without leaving Studio.
          </p>
          {(username || grudgeId) && (
            <p className="text-xs text-muted mt-2 font-mono">
              {username ?? "signed in"}
              {grudgeId ? ` · ${grudgeId}` : ""}
              {admin ? " · admin" : ""}
            </p>
          )}
        </div>
        <div className={`home-truth-card ${healthy ? "ok" : score != null ? "warn" : ""}`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-muted flex items-center gap-1">
              <ShieldCheck size={12} className="text-gold" /> ONE TRUTH
            </span>
            <button
              type="button"
              className="text-muted hover:text-gold"
              title="Refresh fleet probes"
              onClick={() => void refresh()}
            >
              {probing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          </div>
          <div className={`text-3xl font-bold tabular-nums ${scoreColor}`}>
            {score != null ? `${score}%` : "—"}
          </div>
          <div className="text-[11px] text-muted mt-1 flex items-center gap-1.5">
            {conn?.online ? <Wifi size={11} /> : <WifiOff size={11} />}
            {conn?.online
              ? (conn.reachable
                ? `live · ${conn.latencyMs ?? 0}ms`
                : "fleet partially unreachable")
              : "offline"}
          </div>
          <div className="text-[10px] font-mono text-muted/80 truncate mt-1" title={conn?.apiBaseUrl}>
            {conn?.apiBaseUrl ?? FLEET_URLS.client}
          </div>
          {score != null && score < TRUTH_HEALTH_THRESHOLD && (
            <p className="text-[10px] text-gold mt-2">
              Below {TRUTH_HEALTH_THRESHOLD}% — run <span className="font-mono">grudge-dev doctor</span> or open Settings → ONE TRUTH.
            </p>
          )}
        </div>
      </header>

      <section className="home-section">
        <h2 className="home-section-title">Create &amp; run</h2>
        <div className="home-actions">
          <button type="button" className="home-action" onClick={() => onNavigate("/forge")}>
            <Hammer size={22} className="text-gold" />
            <span className="home-action-title">Forge</span>
            <span className="home-action-desc">Scene editor · forge.grudge-studio.com · Quick 3D</span>
          </button>
          <button type="button" className="home-action" onClick={() => onNavigate("/coder")}>
            <Code2 size={22} className="text-gold" />
            <span className="home-action-title">Coder</span>
            <span className="home-action-desc">Agentic IDE · coder.grudge-studio.com · local</span>
          </button>
          <button type="button" className="home-action" onClick={() => onNavigate("/browser")}>
            <FolderTree size={22} className="text-gold" />
            <span className="home-action-title">Assets</span>
            <span className="home-action-desc">Browse object store · CDN · upload</span>
          </button>
          <button type="button" className="home-action" onClick={() => onNavigate("/engine")}>
            <Cpu size={22} className="text-gold" />
            <span className="home-action-title">Engine</span>
            <span className="home-action-desc">Characters · VFX · The-ENGINE hub</span>
          </button>
          <button type="button" className="home-action" onClick={() => onNavigate("/games")}>
            <Gamepad2 size={22} className="text-gold" />
            <span className="home-action-title">Games</span>
            <span className="home-action-desc">Fleet launcher · play modes</span>
          </button>
          <button type="button" className="home-action" onClick={() => onNavigate("/library")}>
            <Store size={22} className="text-gold" />
            <span className="home-action-title">Store</span>
            <span className="home-action-desc">Catalog · packs · library</span>
          </button>
        </div>
      </section>

      <section className="home-section home-two-col">
        <div className="card home-host-card">
          <h2 className="home-section-title mb-3">Canonical hosts</h2>
          <table className="home-host-table">
            <tbody>
              {HOST_ROWS.map((row) => (
                <tr key={row.url}>
                  <td className="home-host-label">{row.label}</td>
                  <td className="home-host-role">{row.role}</td>
                  <td className="home-host-url">
                    <a href={row.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-gold hover:underline">
                      {row.url.replace(/^https:\/\//, "")}
                      <ExternalLink size={10} className="inline ml-1 opacity-60" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted text-[10px] mt-3">
            Always use <span className="font-mono text-gold">client.grudge-studio.com</span> as the API base.
            Coder and Forge remain live web surfaces — Studio embeds them as modules.
          </p>
        </div>

        <div className="card home-host-card">
          <h2 className="home-section-title mb-3">What Studio is</h2>
          <ul className="home-bullets">
            <li><strong>Information</strong> — fleet manifest, ONE TRUTH probes, UUID, docs</li>
            <li><strong>Assets</strong> — R2/objectstore browse, search, ingest, BlenderKit, CDN URLs</li>
            <li><strong>Forge</strong> — full scene editor (web) + Quick 3D for local models</li>
            <li><strong>Coder</strong> — production IDE embedded, or local GrudachainCode</li>
          </ul>
          <div className="flex flex-wrap gap-2 mt-4">
            <button type="button" className="btn ghost text-xs flex items-center gap-1" onClick={() => onNavigate("/docs")}>
              <BookOpen size={12} /> Docs
            </button>
            <button type="button" className="btn ghost text-xs" onClick={() => onNavigate("/settings")}>
              Settings · ONE TRUTH
            </button>
            <button type="button" className="btn ghost text-xs" onClick={() => onNavigate("/search")}>
              Search assets
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
