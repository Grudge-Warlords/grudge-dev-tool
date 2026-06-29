import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, Gamepad2, RefreshCcw } from "lucide-react";

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

const CATEGORY_LABELS: Record<string, string> = {
  action: "Action",
  rpg: "RPG / MMO",
  rts: "RTS / Strategy",
  racing: "Racing",
  puzzle: "Puzzle",
  demo: "Demos",
  tool: "Tools & Admin",
  mobile: "Mobile",
};

function GameThumb({ game }: { game: FleetGame }) {
  const [src, setSrc] = useState(game.thumbnail ?? "");
  const fallback = `https://opengraph.githubassets.com/1/MolochDaGod/${game.repo}`;

  useEffect(() => {
    setSrc(game.thumbnail ?? fallback);
  }, [game.thumbnail, game.repo, fallback]);

  if (!src) return null;

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

export default function FleetLauncher() {
  const [games, setGames] = useState<FleetGame[]>([]);
  const [liveCount, setLiveCount] = useState(0);
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<string>("all");

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

  const categories = useMemo(() => {
    const set = new Set(games.map((g) => g.category));
    return ["all", ...[...set].sort()];
  }, [games]);

  const visible = useMemo(
    () => (category === "all" ? games : games.filter((g) => g.category === category)),
    [games, category],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, FleetGame[]>();
    for (const g of visible) {
      const key = g.category || "other";
      const arr = map.get(key) ?? [];
      arr.push(g);
      map.set(key, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  return (
    <div>
      <h1 className="page-title flex items-center gap-2">
        <Gamepad2 size={20} className="text-gold" /> Fleet Games
      </h1>
      <p className="page-sub">
        Grudge Studio catalog — static fleet registry merged with grudgedot live releases
        {liveCount > 0 && <span className="text-gold"> ({liveCount} live)</span>}.
      </p>
      <div className="flex flex-wrap gap-2 mb-4">
        <button className="btn ghost text-xs flex items-center gap-1" onClick={reload} disabled={busy}>
          <RefreshCcw size={12} /> Refresh
        </button>
        {categories.map((c) => (
          <button
            key={c}
            className={`btn ghost text-xs ${category === c ? "border-gold text-gold" : ""}`}
            onClick={() => setCategory(c)}
          >
            {c === "all" ? "All" : (CATEGORY_LABELS[c] ?? c)}
          </button>
        ))}
      </div>

      {grouped.map(([cat, list]) => (
        <div key={cat} className="mb-6">
          <h2 className="text-sm font-semibold text-gold mb-2 uppercase tracking-wide">
            {CATEGORY_LABELS[cat] ?? cat} ({list.length})
          </h2>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {list.map((g) => (
              <div key={g.id} className="card">
                <GameThumb game={g} />
                <div className="font-semibold text-sm">{g.displayName}</div>
                <div className="text-[10px] text-muted mb-2">{g.engine} · {g.status}</div>
                <p className="text-xs text-muted mb-3 line-clamp-2">{g.description}</p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn ghost text-xs flex items-center gap-1" onClick={() => window.grudge.os.openExternal(g.url)}>
                    <ExternalLink size={12} /> Open
                  </button>
                  {g.releasesUrl && (
                    <button className="btn ghost text-xs" onClick={() => window.grudge.os.openExternal(g.releasesUrl!)}>
                      Releases
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {endpoints.length > 0 && (
        <div className="card mt-4">
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
  );
}