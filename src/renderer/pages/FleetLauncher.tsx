/**
 * Games Hub — play-first fleet catalog + in-app Play Modes.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Gamepad2,
  RefreshCcw,
  Search as SearchIcon,
  Play,
  MonitorPlay,
} from "lucide-react";
import GameModes from "./GameModes";

interface FleetGame {
  id: string;
  displayName: string;
  description: string;
  url: string;
  repo: string;
  engine: string;
  status: string;
  category: string;
  thumbnail?: string;
  releasesUrl?: string;
}

const STATUS_ORDER = ["live", "active", "beta", "planned"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  action: "Action",
  rpg: "RPG / MMO",
  rts: "RTS",
  racing: "Racing",
  puzzle: "Puzzle",
  demo: "Demos",
  tool: "Tools",
  mobile: "Mobile",
};

function statusClass(status: string): string {
  switch (status) {
    case "live":
      return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    case "active":
      return "bg-sky-500/20 text-sky-300 border-sky-500/40";
    case "beta":
      return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    default:
      return "bg-bg-2 text-muted border-line";
  }
}

function GameThumb({ game }: { game: FleetGame }) {
  const fallback = `https://opengraph.githubassets.com/1/MolochDaGod/${game.repo}`;
  const [src, setSrc] = useState(game.thumbnail ?? fallback);

  useEffect(() => {
    setSrc(game.thumbnail ?? fallback);
  }, [game.thumbnail, game.repo, fallback]);

  if (!src) {
    return <div className="w-full h-28 rounded mb-2 bg-bg-2 flex items-center justify-center text-muted"><Gamepad2 size={24} /></div>;
  }

  return (
    <img
      src={src}
      alt=""
      className="w-full h-28 object-cover rounded mb-2 bg-bg-2"
      loading="lazy"
      onError={() => {
        if (src !== fallback) setSrc(fallback);
        else setSrc("");
      }}
    />
  );
}

export default function FleetLauncher({ admin = false }: { admin?: boolean }) {
  const [tab, setTab] = useState<"catalog" | "play">("catalog");
  const [games, setGames] = useState<FleetGame[]>([]);
  const [liveCount, setLiveCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "live" | "active" | "beta">("all");

  async function reload() {
    setBusy(true);
    try {
      const g = await window.grudge.fleet.games();
      const merged = (g?.merged ?? g?.static ?? []) as FleetGame[];
      setGames(merged);
      setLiveCount(Array.isArray(g?.live) ? g.live.length : 0);
    } catch {
      /* offline — static may still arrive empty */
    }
    setBusy(false);
  }

  useEffect(() => {
    void reload();
  }, []);

  const categories = useMemo(() => {
    const set = new Set(games.map((g) => g.category));
    return ["all", ...[...set].sort()];
  }, [games]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return games
      .filter((g) => category === "all" || g.category === category)
      .filter((g) => statusFilter === "all" || g.status === statusFilter)
      .filter((g) => {
        if (!q) return true;
        return (
          g.displayName.toLowerCase().includes(q) ||
          g.description.toLowerCase().includes(q) ||
          g.engine.toLowerCase().includes(q) ||
          g.repo.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const sa = STATUS_ORDER.indexOf(a.status as (typeof STATUS_ORDER)[number]);
        const sb = STATUS_ORDER.indexOf(b.status as (typeof STATUS_ORDER)[number]);
        return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb) || a.displayName.localeCompare(b.displayName);
      });
  }, [games, query, category, statusFilter]);

  const featured = useMemo(
    () => filtered.filter((g) => g.status === "live").slice(0, 6),
    [filtered],
  );

  const rest = useMemo(() => {
    const featuredIds = new Set(featured.map((g) => g.id));
    // When showing all + no search, featured strip already shows live — avoid double cards
    if (statusFilter === "all" && !query.trim() && category === "all") {
      return filtered.filter((g) => !featuredIds.has(g.id));
    }
    return filtered;
  }, [filtered, featured, statusFilter, query, category]);

  function play(g: FleetGame) {
    if (g.url) window.grudge?.os?.openExternal?.(g.url);
  }

  return (
    <div className="flex flex-col h-full min-h-0 games-hub">
      <div className="shrink-0 px-1 pb-3 border-b border-line mb-3">
        <div className="flex items-center gap-3 mb-3">
          <Gamepad2 size={20} className="text-gold" />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-gold">Games</h1>
            <p className="text-[10px] text-muted truncate">
              Fleet catalog
              {liveCount > 0 ? ` · ${liveCount} live releases` : ""}
              {" · "}
              open in browser or play in Studio
            </p>
          </div>
          {tab === "catalog" && (
            <button
              type="button"
              className="btn ghost text-xs flex items-center gap-1"
              onClick={() => void reload()}
              disabled={busy}
            >
              <RefreshCcw size={12} className={busy ? "animate-spin" : ""} /> Refresh
            </button>
          )}
        </div>

        <div className="inline-flex rounded-md border border-line overflow-hidden text-xs">
          <button
            type="button"
            className={
              "px-3 py-1.5 flex items-center gap-1.5 " +
              (tab === "catalog" ? "bg-gold/15 text-gold" : "text-muted hover:text-ink")
            }
            onClick={() => setTab("catalog")}
          >
            <Gamepad2 size={12} /> Catalog
            <span className="opacity-70">{games.length}</span>
          </button>
          <button
            type="button"
            className={
              "px-3 py-1.5 border-l border-line flex items-center gap-1.5 " +
              (tab === "play" ? "bg-gold/15 text-gold" : "text-muted hover:text-ink")
            }
            onClick={() => setTab("play")}
            title={admin ? "Embed live playables in Studio" : "Play modes"}
          >
            <MonitorPlay size={12} /> Play in Studio
          </button>
        </div>
      </div>

      {tab === "play" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <GameModes embedded />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto space-y-4 pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <SearchIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="w-full text-xs pl-7"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search games…"
                aria-label="Search games"
              />
            </div>
            <select
              className="text-xs bg-bg-2 border border-line rounded px-2 py-1.5 max-w-[140px]"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === "all" ? "All categories" : (CATEGORY_LABELS[c] ?? c)}
                </option>
              ))}
            </select>
            <select
              className="text-xs bg-bg-2 border border-line rounded px-2 py-1.5"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="all">All statuses</option>
              <option value="live">Live</option>
              <option value="active">Active</option>
              <option value="beta">Beta</option>
            </select>
            <span className="text-[10px] text-muted ml-auto tabular-nums">
              {filtered.length} shown
            </span>
          </div>

          {featured.length > 0 && statusFilter === "all" && !query.trim() && category === "all" && (
            <section>
              <h2 className="text-[11px] uppercase tracking-wide text-muted mb-2">Live now</h2>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                {featured.map((g) => (
                  <GameCard key={g.id} game={g} onPlay={() => play(g)} featured />
                ))}
              </div>
            </section>
          )}

          {rest.length === 0 && featured.length === 0 ? (
            <div className="card text-center text-sm text-muted py-10">
              {busy ? "Loading fleet…" : "No games match this filter."}
            </div>
          ) : rest.length > 0 ? (
            <section>
              {featured.length > 0 && statusFilter === "all" && !query.trim() && category === "all" && (
                <h2 className="text-[11px] uppercase tracking-wide text-muted mb-2">More</h2>
              )}
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
                {rest.map((g) => (
                  <GameCard key={g.id} game={g} onPlay={() => play(g)} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function GameCard({
  game,
  onPlay,
  featured,
}: {
  game: FleetGame;
  onPlay: () => void;
  featured?: boolean;
}) {
  return (
    <div className={"card flex flex-col mb-0 " + (featured ? "border-gold/25" : "")}>
      <GameThumb game={game} />
      <div className="flex items-start gap-2 mb-1">
        <div className="font-semibold text-sm flex-1 min-w-0 leading-snug">{game.displayName}</div>
        <span
          className={
            "shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border " +
            statusClass(game.status)
          }
        >
          {game.status}
        </span>
      </div>
      <div className="text-[10px] text-muted mb-1">
        {game.engine} · {CATEGORY_LABELS[game.category] ?? game.category}
      </div>
      <p className="text-xs text-muted mb-3 line-clamp-2 flex-1">{game.description}</p>
      <div className="flex flex-wrap gap-2 mt-auto">
        {game.url && (
          <button type="button" className="btn text-xs flex items-center gap-1" onClick={onPlay}>
            <Play size={12} /> Play
          </button>
        )}
        {game.releasesUrl && (
          <button
            type="button"
            className="btn ghost text-xs flex items-center gap-1"
            onClick={() => window.grudge?.os?.openExternal?.(game.releasesUrl!)}
          >
            <ExternalLink size={12} /> Releases
          </button>
        )}
      </div>
    </div>
  );
}
