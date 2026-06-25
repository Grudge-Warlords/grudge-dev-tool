import React, { useEffect, useState } from "react";
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

export default function FleetLauncher() {
  const [games, setGames] = useState<FleetGame[]>([]);
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setBusy(true);
    try {
      const [g, e] = await Promise.all([
        window.grudge.fleet.games(),
        window.grudge.fleet.endpoints(),
      ]);
      const merged = (g?.merged ?? g?.static ?? []) as FleetGame[];
      setGames(merged);
      setEndpoints(e ?? []);
    } catch { /* offline */ }
    setBusy(false);
  }

  useEffect(() => { void reload(); }, []);

  return (
    <div>
      <h1 className="page-title flex items-center gap-2">
        <Gamepad2 size={20} className="text-gold" /> Fleet Games
      </h1>
      <p className="page-sub">
        Grudge Studio game catalog — static fleet registry merged with live grudgedot releases when available.
      </p>
      <div className="flex gap-2 mb-4">
        <button className="btn ghost text-xs flex items-center gap-1" onClick={reload} disabled={busy}>
          <RefreshCcw size={12} /> Refresh
        </button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {games.map((g) => (
          <div key={g.id} className="card">
            {g.thumbnail && (
              <img src={g.thumbnail} alt="" className="w-full h-28 object-cover rounded mb-2 bg-bg-2" />
            )}
            <div className="font-semibold text-sm">{g.displayName}</div>
            <div className="text-[10px] text-muted mb-2">{g.engine} · {g.status} · {g.category}</div>
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