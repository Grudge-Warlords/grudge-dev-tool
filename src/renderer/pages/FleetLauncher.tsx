import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, Gamepad2, RefreshCcw, Search as SearchIcon, Filter } from "lucide-react";
import GameModes from "./GameModes";
import { useWorkspaceField } from "../lib/useWorkspaceField";

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
const CATEGORIES = ["all", "action", "rpg", "rts", "racing", "puzzle", "demo", "tool", "mobile"] as const;

function statusClass(status: string): string {
  switch (status) {
    case "live": return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    case "active": return "bg-sky-500/20 text-sky-300 border-sky-500/40";
    case "beta": return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    case "planned": return "bg-zinc-500/20 text-zinc-300 border-zinc-500/40";
    default: return "bg-bg-2 text-muted border-line";
  }
}

export default function FleetLauncher() {
  const [tab, setTab] = useWorkspaceField("gamesTab", "fleet");
  const [games, setGames] = useState<FleetGame[]>([]);
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [liveCount, setLiveCount] = useState(0);

  async function reload() {
    setBusy(true);
    try {
      const [g, e] = await Promise.all([
        window.grudge.fleet.games(),
        window.grudge.fleet.endpoints(),
      ]);
      const merged = (g?.merged ?? g?.static ?? []) as FleetGame[];
      setGames(merged);
      setLiveCount(Array.isArray(g?.live) ? g.live.length : 0);
      setEndpoints(e ?? []);
    } catch { /* offline */ }
    setBusy(false);
  }

  useEffect(() => { void reload(); }, []);

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
          g.repo.toLowerCase().includes(q) ||
          g.category.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const sa = STATUS_ORDER.indexOf(a.status as typeof STATUS_ORDER[number]);
        const sb = STATUS_ORDER.indexOf(b.status as typeof STATUS_ORDER[number]);
        return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb) || a.displayName.localeCompare(b.displayName);
      });
  }, [games, query, category, statusFilter]);

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of games) m[g.status] = (m[g.status] ?? 0) + 1;
    return m;
  }, [games]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 py-3 border-b border-line bg-bg-2/50">
        <div className="flex items-center gap-3 mb-3">
          <Gamepad2 size={20} className="text-gold" />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold">Games Hub</h1>
            <p className="text-[10px] text-muted truncate">
              Fleet catalog · live grudgedot releases · local Forge play modes
            </p>
          </div>
          {tab === "fleet" && (
            <button className="btn ghost text-xs flex items-center gap-1" onClick={reload} disabled={busy}>
              <RefreshCcw size={12} className={busy ? "animate-spin" : ""} /> Refresh
            </button>
          )}
        </div>
        <div className="inline-flex rounded-md border border-line overflow-hidden text-xs">
          <button
            type="button"
            className={`px-3 py-1.5 ${tab === "fleet" ? "bg-gold/15 text-gold" : "text-muted hover:text-ink"}`}
            onClick={() => setTab("fleet")}
          >
            Fleet catalog
            <span className="ml-1.5 text-[10px] opacity-70">{games.length}</span>
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 border-l border-line ${tab === "prototypes" ? "bg-gold/15 text-gold" : "text-muted hover:text-ink"}`}
            onClick={() => setTab("prototypes")}
          >
            Play modes
          </button>
        </div>
      </div>

      {tab === "prototypes" ? (
        <div className="flex-1 min-h-0">
          <GameModes embedded />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-md">
              <SearchIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="w-full text-xs pl-7"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search games, engines, repos…"
              />
            </div>
            <div className="flex items-center gap-1 text-xs text-muted">
              <Filter size={12} />
              <select
                className="text-xs bg-bg-2 border border-line rounded px-2 py-1"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>
                ))}
              </select>
              <select
                className="text-xs bg-bg-2 border border-line rounded px-2 py-1"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All statuses</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{s} ({statusCounts[s] ?? 0})</option>
                ))}
              </select>
            </div>
            <span className="text-[10px] text-muted ml-auto">
              {filtered.length} shown
              {liveCount > 0 ? ` · ${liveCount} live merge` : ""}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="card text-center text-sm text-muted py-10">
              {busy ? "Loading fleet…" : "No games match this filter."}
            </div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {filtered.map((g) => (
                <div key={g.id} className="card flex flex-col">
                  {g.thumbnail && (
                    <img src={g.thumbnail} alt="" className="w-full h-28 object-cover rounded mb-2 bg-bg-2" />
                  )}
                  <div className="flex items-start gap-2 mb-1">
                    <div className="font-semibold text-sm flex-1 min-w-0">{g.displayName}</div>
                    <span className={`shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${statusClass(g.status)}`}>
                      {g.status}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted mb-2">
                    {g.engine} · {g.category}
                  </div>
                  <p className="text-xs text-muted mb-3 line-clamp-2 flex-1">{g.description}</p>
                  <div className="flex flex-wrap gap-2 mt-auto">
                    {g.url && (
                      <button className="btn ghost text-xs flex items-center gap-1" onClick={() => window.grudge.os.openExternal(g.url)}>
                        <ExternalLink size={12} /> Open
                      </button>
                    )}
                    {g.releasesUrl && (
                      <button className="btn ghost text-xs" onClick={() => window.grudge.os.openExternal(g.releasesUrl!)}>
                        Releases
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {endpoints.length > 0 && (
            <div className="card mt-2">
              <h3 className="text-sm font-semibold mb-2">ONE TRUTH endpoints</h3>
              <table>
                <tbody>
                  {endpoints.map((ep: any) => (
                    <tr key={ep.id}>
                      <td className="muted text-xs">{ep.label}</td>
                      <td className="font-mono text-[10px]">{ep.url}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
