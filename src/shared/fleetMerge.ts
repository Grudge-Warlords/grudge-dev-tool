import type { FleetGame } from "./fleetGames";

const THUMB = (repo: string) =>
  `https://opengraph.githubassets.com/1/MolochDaGod/${repo}`;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function liveGameId(rec: Record<string, unknown>): string | null {
  return (
    String(rec.id ?? rec.slug ?? rec.name ?? rec.repo ?? "")
      .trim()
      .toLowerCase() || null
  );
}

/** Merge grudgedot live releases into the static fleet registry. */
export function mergeFleetGames(staticGames: FleetGame[], liveRaw: unknown[]): FleetGame[] {
  if (!liveRaw.length) return staticGames;

  const byId = new Map(staticGames.map((g) => [g.id.toLowerCase(), { ...g }]));
  const byRepo = new Map(staticGames.map((g) => [g.repo.toLowerCase(), g.id.toLowerCase()]));

  for (const entry of liveRaw) {
    const rec = asRecord(entry);
    if (!rec) continue;

    const liveId = liveGameId(rec);
    const repo = String(rec.repo ?? rec.repository ?? rec.github ?? "").trim();
    const matchId =
      (liveId && byId.has(liveId) ? liveId : null) ??
      (repo && byRepo.has(repo.toLowerCase()) ? byRepo.get(repo.toLowerCase())! : null);

    const displayName = String(rec.displayName ?? rec.title ?? rec.name ?? "").trim();
    const description = String(rec.description ?? rec.tagline ?? "").trim();
    const url = String(rec.url ?? rec.playUrl ?? rec.homepage ?? "").trim();
    const releasesUrl = String(rec.releasesUrl ?? rec.downloadUrl ?? rec.releasePage ?? "").trim();
    const status = String(rec.status ?? rec.state ?? "").trim() as FleetGame["status"] | "";
    const engine = String(rec.engine ?? rec.tech ?? "").trim();
    const thumbnail = String(rec.thumbnail ?? rec.image ?? "").trim();

    if (matchId) {
      const g = byId.get(matchId)!;
      if (displayName) g.displayName = displayName;
      if (description) g.description = description;
      if (url) g.url = url;
      if (releasesUrl) g.releasesUrl = releasesUrl;
      if (status && ["live", "active", "beta", "planned"].includes(status)) g.status = status;
      if (engine) g.engine = engine;
      if (thumbnail) g.thumbnail = thumbnail;
      continue;
    }

    if (!displayName && !repo) continue;

    const id = liveId ?? repo.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (byId.has(id)) continue;

    byId.set(id, {
      id,
      name: repo || displayName,
      displayName: displayName || repo || id,
      description: description || "Live entry from grudgedot.",
      url: url || (repo ? `https://github.com/MolochDaGod/${repo}` : "https://grudgedot.vercel.app"),
      repo: repo || id,
      engine: engine || "Web",
      status: status && ["live", "active", "beta", "planned"].includes(status) ? status : "beta",
      category: "tool",
      topics: ["grudgedot"],
      thumbnail: thumbnail || (repo ? THUMB(repo) : undefined),
      releasesUrl: releasesUrl || undefined,
    });
  }

  return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}