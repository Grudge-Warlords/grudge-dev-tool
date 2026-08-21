/**
 * Studio Hub — command center for fleet systems + games.
 * Intentionally short: big actions, live games, compact health.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  FolderTree,
  Hammer,
  Bot,
  Gamepad2,
  ShieldCheck,
  Globe,
  Database,
  Package,
  RefreshCw,
  ExternalLink,
  Play,
  MonitorPlay,
  ChevronDown,
  ChevronRight,
  Bone,
  Upload,
  FolderSearch,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { FLEET_URLS, TRUTH_HEALTH_THRESHOLD, buildTruthProbes, type TruthProbe } from "../../shared/fleet";
import { FLEET_GAMES, type FleetGame } from "../../shared/fleetGames";

/** Daily production admin loop — matches primary nav (no dead chips). */
const PRIMARY: Array<{
  id: string;
  label: string;
  desc: string;
  route: string;
  Icon: LucideIcon;
  adminOnly?: boolean;
}> = [
  {
    id: "local",
    label: "Local Files",
    desc: "Disk · 3D → ThreeFlow · media → Elite",
    route: "/local",
    Icon: FolderSearch,
  },
  {
    id: "assets",
    label: "Assets",
    desc: "R2 · search · open in View Mode",
    route: "/browser",
    Icon: FolderTree,
  },
  {
    id: "skeleton",
    label: "Skeleton",
    desc: "Mixamo-25 · extract · T-pose · retarget pack",
    route: "/skeleton",
    Icon: Bone,
    adminOnly: true,
  },
  {
    id: "forge",
    label: "Forge",
    desc: "forge.grudge-studio.com · R3F + Rapier",
    route: "/forge",
    Icon: Hammer,
    adminOnly: true,
  },
  {
    id: "preview",
    label: "Preview",
    desc: "Play-test open / client / water / GRUDOX / Multiverse",
    route: "/preview",
    Icon: Play,
    adminOnly: true,
  },
  {
    id: "play",
    label: "Play",
    desc: "Native Three · Toon kit · WASD · one mixer",
    route: "/play",
    Icon: MonitorPlay,
  },
  {
    id: "upload",
    label: "Upload",
    desc: "Convert · verify · push packs to R2",
    route: "/upload",
    Icon: Upload,
    adminOnly: true,
  },
  {
    id: "games",
    label: "Play Games",
    desc: "Open · Multiverse · client · GRUDOX · Warlords",
    route: "/games",
    Icon: Gamepad2,
  },
  {
    id: "ai",
    label: "Agent AI",
    desc: "Make & deploy · orchestrator · Ollama",
    route: "/ai",
    Icon: Bot,
  },
];

/** Core production playables pinned on Home. */
const FEATURED_IDS = [
  "grudgewarlords",
  "grudge-arena",
  "rts-grudge",
  "grudges-survival",
  "grudge-drive",
  "studio-forge",
  "dungeon-crawler",
] as const;

interface ConnSnap {
  reachable?: boolean;
  online?: boolean;
  apiBaseUrl?: string;
  latencyMs?: number | null;
  truthScore?: number | null;
  error?: string | null;
}

export default function StudioHub({
  onNavigate,
  admin = false,
  username,
}: {
  onNavigate?: (route: string) => void;
  admin?: boolean;
  username?: string | null;
}) {
  const [conn, setConn] = useState<ConnSnap | null>(null);
  const [probes, setProbes] = useState<TruthProbe[]>([]);
  const [checking, setChecking] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const featured = FEATURED_IDS.map((id) => FLEET_GAMES.find((g) => g.id === id)).filter(
    (g): g is FleetGame => Boolean(g),
  );

  const refreshConn = useCallback(async () => {
    try {
      const s = await window.grudge?.connectivity?.get?.();
      if (s) setConn(s);
    } catch {
      /* offline */
    }
  }, []);

  const runProbes = useCallback(async () => {
    setChecking(true);
    try {
      await window.grudge?.connectivity?.probe?.();
    } catch {
      /* optional IPC */
    }
    await refreshConn();

    const list = buildTruthProbes(FLEET_URLS.client);
    const next = await Promise.all(
      list.map(async (p) => {
        const t0 = performance.now();
        try {
          const res = await fetch(p.url, {
            method: p.role === "assets" ? "HEAD" : "GET",
            mode: "cors",
          });
          const authOk = p.id === "auth-me" && (res.status === 401 || res.status === 200);
          return {
            ...p,
            ok: res.ok || authOk || res.status === 401,
            status: res.status,
            latencyMs: Math.round(performance.now() - t0),
            detail: res.ok || authOk ? "ok" : res.statusText || String(res.status),
          } satisfies TruthProbe;
        } catch (e: unknown) {
          return {
            ...p,
            ok: false,
            status: null,
            latencyMs: Math.round(performance.now() - t0),
            detail: e instanceof Error ? e.message : "unreachable",
          } satisfies TruthProbe;
        }
      }),
    );
    setProbes(next);
    setChecking(false);
    const score = Math.round((next.filter((x) => x.ok).length / Math.max(1, next.length)) * 100);
    toast.message(`Fleet ${score}%`, {
      description: `${next.filter((x) => x.ok).length}/${next.length} systems reachable`,
    });
  }, [refreshConn]);

  useEffect(() => {
    void refreshConn();
    void runProbes();
    const off = window.grudge?.connectivity?.onChange?.((s: ConnSnap) => setConn(s));
    return () => off?.();
  }, [refreshConn, runProbes]);

  const probeScore =
    probes.length === 0
      ? null
      : Math.round((probes.filter((x) => x.ok).length / probes.length) * 100);
  const score = conn?.truthScore ?? probeScore;
  const healthy = score != null && score >= TRUTH_HEALTH_THRESHOLD;
  const scoreCls =
    score == null ? "text-muted" : healthy ? "text-ok" : score >= 50 ? "text-gold" : "text-danger";

  const actions = PRIMARY.filter((a) => !a.adminOnly || admin);

  function openGame(g: FleetGame) {
    if (g.url) window.grudge?.os?.openExternal?.(g.url);
  }

  return (
    <div className="hub">
      <header className="hub-hero">
        <div className="min-w-0">
          <p className="hub-kicker">Command center</p>
          <h1 className="page-title mb-1">Grudge Studio</h1>
          <p className="page-sub mb-0 max-w-xl">
            Admin shell: Assets → Forge (same as DNS) → Preview playtests → Agent AI. Wired to
            client · info.* · ObjectStore · ENGINE · open.* · GRUDOX · Builder on ONE TRUTH.
            {username ? (
              <span className="block text-[11px] font-mono mt-1 opacity-80">{username}</span>
            ) : null}
          </p>
        </div>

        <div className={`hub-truth ${healthy ? "ok" : score != null ? "warn" : ""}`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-muted flex items-center gap-1">
              <ShieldCheck size={12} className="text-gold" /> ONE TRUTH
            </span>
            <button
              type="button"
              className="text-muted hover:text-gold p-0.5"
              title="Re-check fleet"
              disabled={checking}
              onClick={() => void runProbes()}
            >
              <RefreshCw size={12} className={checking ? "animate-spin" : ""} />
            </button>
          </div>
          <div className={`text-3xl font-bold tabular-nums ${scoreCls}`}>
            {score != null ? `${score}%` : "—"}
          </div>
          <div className="text-[11px] text-muted mt-1">
            {conn?.online
              ? conn.reachable
                ? `live · ${conn.latencyMs ?? 0}ms`
                : "partial"
              : conn
                ? "offline"
                : "checking…"}
          </div>
          <div className="text-[10px] font-mono text-muted/80 truncate mt-0.5" title={conn?.apiBaseUrl}>
            {(conn?.apiBaseUrl ?? FLEET_URLS.client).replace(/^https:\/\//, "")}
          </div>
          {score != null && score < TRUTH_HEALTH_THRESHOLD && (
            <p className="text-[10px] text-gold mt-2 leading-snug">
              Below {TRUTH_HEALTH_THRESHOLD}% — Settings → ONE TRUTH or{" "}
              <span className="font-mono">grudge-dev doctor</span>
            </p>
          )}
        </div>
      </header>

      <section className="hub-section">
        <h2 className="hub-section-title">Do this</h2>
        <div className="hub-actions">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="hub-action"
              onClick={() => onNavigate?.(a.route)}
            >
              <a.Icon size={22} className="text-gold shrink-0" />
              <span className="hub-action-title">{a.label}</span>
              <span className="hub-action-desc">{a.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="hub-section">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="hub-section-title mb-0">Featured games</h2>
          <button type="button" className="btn ghost text-xs" onClick={() => onNavigate?.("/games")}>
            All games
          </button>
        </div>
        <div className="hub-games">
          {featured.map((g) => (
            <div key={g.id} className="hub-game-card">
              <div className="flex items-start gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink truncate">{g.displayName}</div>
                  <div className="text-[10px] text-muted truncate">
                    {g.engine} · {g.status}
                  </div>
                </div>
                <span
                  className={
                    "shrink-0 text-[9px] uppercase px-1.5 py-0.5 rounded border " +
                    (g.status === "live"
                      ? "border-ok/40 text-ok bg-ok/10"
                      : "border-line text-muted")
                  }
                >
                  {g.status}
                </span>
              </div>
              <p className="text-[11px] text-muted line-clamp-2 mt-1 mb-2 flex-1">{g.description}</p>
              <button type="button" className="btn text-xs w-full flex items-center justify-center gap-1" onClick={() => openGame(g)}>
                <Play size={12} /> Play
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="hub-section">
        <h2 className="hub-section-title">Systems (admin)</h2>
        <div className="hub-systems">
          <SystemChip
            Icon={Globe}
            label="Client ONE TRUTH"
            url={FLEET_URLS.client}
            ok={probes.find((p) => p.id === "auth-me" || p.id === "os-items")?.ok}
          />
          <SystemChip Icon={ShieldCheck} label="Grudge ID" url={FLEET_URLS.auth} ok={probes.find((p) => p.id === "id-health")?.ok} />
          <SystemChip
            Icon={Database}
            label="Railway game-data"
            url={FLEET_URLS.gameData}
            ok={probes.find((p) => p.id === "railway-health")?.ok}
          />
          <SystemChip Icon={Globe} label="ENGINE portal" url={FLEET_URLS.identityApi} />
          <SystemChip Icon={Package} label="Assets CDN" url={FLEET_URLS.assets} ok={probes.find((p) => p.id === "icon-cdn")?.ok} />
          <SystemChip
            Icon={FolderTree}
            label="ObjectStore"
            url={FLEET_URLS.objectStore}
            ok={probes.find((p) => p.id === "os-direct" || p.id === "os-items")?.ok}
          />
          <SystemChip Icon={Package} label="info.* catalogs" url={FLEET_URLS.info} />
          <SystemChip Icon={Bot} label="Legion AI" url={FLEET_URLS.ai} />
          <SystemChip Icon={Hammer} label="Forge" url={FLEET_URLS.forge} />
          <SystemChip Icon={Globe} label="Open launcher" url={FLEET_URLS.open} />
          <SystemChip Icon={Globe} label="GRUDOX" url={FLEET_URLS.grudox} />
          <SystemChip Icon={Globe} label="Coder" url={FLEET_URLS.coder} />
          <SystemChip Icon={Globe} label="Builder" url={FLEET_URLS.grokBuilder} />
          <SystemChip Icon={Globe} label="Water island" url={FLEET_URLS.water} />
        </div>

        <button
          type="button"
          className="hub-details-toggle mt-3"
          onClick={() => setDetailsOpen((v) => !v)}
        >
          {detailsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Probe details
          {probes.length > 0 && (
            <span className="text-muted font-normal">
              · {probes.filter((p) => p.ok).length}/{probes.length} ok
            </span>
          )}
        </button>

        {detailsOpen && probes.length > 0 && (
          <div className="hub-probe-grid mt-2">
            {probes.map((p) => (
              <div
                key={p.id}
                className={
                  "hub-probe " + (p.ok ? "ok" : "bad")
                }
              >
                <span className={"hub-probe-dot " + (p.ok ? "ok" : "bad")} />
                <div className="min-w-0 flex-1">
                  <div className="text-ink truncate text-xs">{p.label}</div>
                  <div className="text-muted font-mono truncate text-[10px]">{p.url.replace(/^https:\/\//, "")}</div>
                </div>
                <span className="text-muted text-[10px] tabular-nums">{p.latencyMs ?? "—"}ms</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SystemChip({
  Icon,
  label,
  url,
  ok,
}: {
  Icon: LucideIcon;
  label: string;
  url: string;
  ok?: boolean;
}) {
  return (
    <button
      type="button"
      className={"hub-system-chip " + (ok === true ? "ok" : ok === false ? "bad" : "")}
      title={url}
      onClick={() => window.grudge?.os?.openExternal?.(url)}
    >
      <span className={"hub-probe-dot " + (ok === true ? "ok" : ok === false ? "bad" : "idle")} />
      <Icon size={13} className="text-gold shrink-0" />
      <span className="truncate">{label}</span>
      <ExternalLink size={10} className="opacity-50 shrink-0" />
    </button>
  );
}
