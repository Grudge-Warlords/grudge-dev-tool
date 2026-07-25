/**
 * Studio Hub — ONE TRUTH control center for assets, DB, games, and agent AI.
 */
import React, { useEffect, useState } from "react";
import {
  FolderTree,
  Hammer,
  Bot,
  Upload,
  Database,
  ExternalLink,
  ShieldCheck,
  Globe,
  Search,
  Boxes,
  Play,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { FLEET_URLS, buildTruthProbes, type TruthProbe } from "../../shared/fleet";

const QUICK: Array<{
  id: string;
  label: string;
  desc: string;
  route?: string;
  href?: string;
  Icon: LucideIcon;
}> = [
  {
    id: "assets",
    label: "Object Storage Browser",
    desc: "Browse R2 CDN assets · click to open Viewer · send to Forge",
    route: "/browser",
    Icon: FolderTree,
  },
  {
    id: "search",
    label: "Asset Search",
    desc: "Server-side objectstore search across packs",
    route: "/search",
    Icon: Search,
  },
  {
    id: "upload",
    label: "Upload / Convert",
    desc: "Ingest GLB/FBX, bake, optimize web, push to R2",
    route: "/upload",
    Icon: Upload,
  },
  {
    id: "forge",
    label: "Forge 3D Editor",
    desc: "Scene edit · paint · deploy · add viewer assets",
    route: "/forge",
    Icon: Hammer,
  },
  {
    id: "ai",
    label: "Agent AI / Dev Portal",
    desc: "Orchestrator · make & deploy anything via GRUDA + fleet",
    route: "/ai",
    Icon: Bot,
  },
  {
    id: "blenderkit",
    label: "BlenderKit Library",
    desc: "Search / download models into local pipeline",
    route: "/blenderkit",
    Icon: Boxes,
  },
  {
    id: "warlords",
    label: "Grudge Warlords",
    desc: "Production game client · heroes · combat lab",
    href: FLEET_URLS.warlords,
    Icon: Play,
  },
  {
    id: "client",
    label: "Fleet Client (ONE TRUTH)",
    desc: "client.grudge-studio.com · rewrites · health",
    href: FLEET_URLS.client,
    Icon: Globe,
  },
  {
    id: "railway",
    label: "Game Data API",
    desc: "Railway Postgres SSOT · characters · accounts",
    href: `${FLEET_URLS.gameData}/api/health`,
    Icon: Database,
  },
  {
    id: "id",
    label: "Grudge ID",
    desc: "Identity / SSO · id.grudge-studio.com",
    href: FLEET_URLS.auth,
    Icon: ShieldCheck,
  },
];

export default function StudioHub({
  onNavigate,
}: {
  onNavigate?: (route: string) => void;
}) {
  const [probes, setProbes] = useState<TruthProbe[]>([]);
  const [checking, setChecking] = useState(false);

  async function runProbes() {
    setChecking(true);
    const list = buildTruthProbes(FLEET_URLS.client);
    const next: TruthProbe[] = [];
    for (const p of list) {
      const t0 = performance.now();
      try {
        const res = await fetch(p.url, { method: "GET", mode: "cors" });
        next.push({
          ...p,
          ok: res.ok || res.status === 401,
          status: res.status,
          latencyMs: Math.round(performance.now() - t0),
          detail: res.ok || res.status === 401 ? "ok" : res.statusText,
        });
      } catch (e: unknown) {
        next.push({
          ...p,
          ok: false,
          status: null,
          latencyMs: Math.round(performance.now() - t0),
          detail: e instanceof Error ? e.message : "fetch failed",
        });
      }
    }
    setProbes(next);
    setChecking(false);
    const score = Math.round((next.filter((x) => x.ok).length / Math.max(1, next.length)) * 100);
    toast.message(`Fleet probe ${score}%`, {
      description: `${next.filter((x) => x.ok).length}/${next.length} endpoints reachable`,
    });
  }

  useEffect(() => {
    void runProbes();
  }, []);

  const score =
    probes.length === 0
      ? null
      : Math.round((probes.filter((x) => x.ok).length / probes.length) * 100);

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="page-title flex items-center gap-2">
          <Globe size={22} className="text-gold" />
          Grudge Studio Hub
        </h1>
        <p className="page-sub">
          Best-in-class asset viewer, opener, and editor — wired to ONE TRUTH databases, CDN
          assets, and agentic AI for make & deploy.
        </p>
      </header>

      <section className="card flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[180px]">
          <div className="text-[10px] uppercase tracking-wider text-muted">Fleet health</div>
          <div className="text-lg font-semibold text-gold">
            {score == null ? "…" : `ONE TRUTH ${score}%`}
          </div>
          <div className="text-[11px] text-muted font-mono truncate">{FLEET_URLS.client}</div>
        </div>
        <button type="button" className="btn" disabled={checking} onClick={() => void runProbes()}>
          <RefreshCw size={14} className={checking ? "animate-spin" : ""} /> Re-probe
        </button>
      </section>

      {probes.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-2">
          {probes.map((p) => (
            <div
              key={p.id}
              className={`border rounded px-3 py-2 text-xs flex items-center gap-2 ${
                p.ok ? "border-ok/30 bg-ok/5" : "border-danger/30 bg-danger/5"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${p.ok ? "bg-ok" : "bg-danger"}`} />
              <div className="min-w-0 flex-1">
                <div className="text-ink truncate">{p.label}</div>
                <div className="text-muted font-mono truncate text-[10px]">{p.url}</div>
              </div>
              <span className="text-muted">{p.latencyMs ?? "—"}ms</span>
            </div>
          ))}
        </div>
      )}

      <section>
        <h2 className="text-sm font-semibold text-ink mb-2">Open · View · Edit · Deploy</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {QUICK.map((q) => (
            <button
              key={q.id}
              type="button"
              className="card text-left hover:border-gold/40 transition border border-line p-3 flex gap-3"
              onClick={() => {
                if (q.route && onNavigate) onNavigate(q.route);
                else if (q.href) window.grudge?.os?.openExternal?.(q.href);
              }}
            >
              <q.Icon size={20} className="text-gold shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink flex items-center gap-1">
                  {q.label}
                  {q.href && <ExternalLink size={11} className="text-muted" />}
                </div>
                <div className="text-[11px] text-muted leading-snug">{q.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="card text-xs text-muted space-y-1">
        <div className="text-ink font-semibold text-sm mb-1">How to work</div>
        <p>
          1. <strong className="text-ink">Assets</strong> — open Object Storage Browser; click any file
          to pop-out the always-on-top Asset Viewer (3D / image / audio / text).
        </p>
        <p>
          2. <strong className="text-ink">Edit</strong> — send GLB/scene to Forge 3D; Skeleton Studio
          for rigs; convert/optimize on upload.
        </p>
        <p>
          3. <strong className="text-ink">Database</strong> — Railway game-data holds characters /
          accounts (grudachain vault); ObjectStore holds definitions JSON.
        </p>
        <p>
          4. <strong className="text-ink">Agent AI</strong> — describe what to make or deploy; orchestrator
          plans steps against fleet URLs and local pods.
        </p>
      </section>
    </div>
  );
}
