/**
 * Docs — same Markdown source as GitHub Pages (docs/).
 * In-app catalog + open published site + optional external editor path.
 */
import React, { useMemo, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  FileText,
  Globe,
  Search,
} from "lucide-react";
import {
  DOCS_CATALOG,
  DOCS_GROUP_LABELS,
  docsPagesUrl,
  type DocEntry,
} from "../../shared/docsCatalog";

const PAGES_HOME = "https://grudge-warlords.github.io/grudge-dev-tool/";

const GROUPS: DocEntry["group"][] = [
  "start",
  "production",
  "assets",
  "tools",
  "ai",
  "systems",
];

export default function Docs() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<DocEntry["group"] | "all">("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return DOCS_CATALOG.filter((d) => {
      if (group !== "all" && d.group !== group) return false;
      if (!needle) return true;
      return (
        d.title.toLowerCase().includes(needle) ||
        d.description.toLowerCase().includes(needle) ||
        d.file.toLowerCase().includes(needle)
      );
    });
  }, [q, group]);

  const openPages = (entry?: DocEntry) => {
    const url = entry ? docsPagesUrl(entry.pagesPath) : PAGES_HOME;
    void window.grudge?.os?.openExternal?.(url);
  };

  return (
    <div className="p-5 max-w-4xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <BookOpen size={20} className="text-gold" />
            Docs
          </h1>
          <p className="page-sub max-w-xl">
            Single source: repo <span className="kbd">docs/</span> → GitHub Pages and this tab.
            Deployment best practices, Forge/Coder/Preview admin wiring, assets, AI.
          </p>
        </div>
        <button
          type="button"
          className="btn flex items-center gap-1.5 text-sm"
          onClick={() => openPages()}
        >
          <Globe size={14} />
          Open published site
        </button>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[12rem]">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="w-full pl-7 pr-2 py-1.5 text-sm bg-bg-2 border border-line rounded"
              placeholder="Search docs…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            className="text-sm bg-bg-2 border border-line rounded px-2 py-1.5"
            value={group}
            onChange={(e) => setGroup(e.target.value as DocEntry["group"] | "all")}
          >
            <option value="all">All groups</option>
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {DOCS_GROUP_LABELS[g]}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[11px] text-muted">
          Pages workflow: <span className="font-mono">.github/workflows/pages.yml</span> builds
          Jekyll from <span className="font-mono">docs/</span> on{" "}
          <span className="font-mono">main</span>. Repo Settings → Pages → GitHub Actions.
        </p>
      </div>

      {GROUPS.map((g) => {
        const items = filtered.filter((d) => d.group === g);
        if (!items.length) return null;
        return (
          <section key={g} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {DOCS_GROUP_LABELS[g]}
            </h2>
            <div className="card divide-y divide-[var(--line)] p-0 overflow-hidden">
              {items.map((d) => (
                <div
                  key={d.id}
                  className="flex items-start gap-3 px-3 py-2.5 hover:bg-bg-2/50"
                >
                  <FileText size={16} className="text-gold shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <strong className="text-sm">{d.title}</strong>
                      {d.primary && (
                        <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gold/15 text-gold">
                          core
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted mt-0.5">{d.description}</p>
                    <div className="text-[10px] font-mono text-muted/80 mt-1">docs/{d.file}</div>
                  </div>
                  <button
                    type="button"
                    className="btn ghost text-[11px] shrink-0 flex items-center gap-1"
                    onClick={() => openPages(d)}
                  >
                    <ExternalLink size={12} /> Open
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {filtered.length === 0 && (
        <div className="card text-sm text-muted">No docs match that filter.</div>
      )}

      <div className="card text-xs text-muted space-y-1">
        <p>
          <strong className="text-ink">Admin pattern:</strong> Forge tab embeds{" "}
          <span className="font-mono">forge.grudge-studio.com</span> (same deploy source). Preview
          loads open/client/water/GRUDOX for playtests. Coder embeds{" "}
          <span className="font-mono">coder.grudge-studio.com</span>. Assets use D1 index + R2 CDN +
          Agent AI search.
        </p>
        <p>
          Production SSOT skills: <span className="font-mono">grudge-studio</span> →{" "}
          <span className="font-mono">forge-editor</span> ·{" "}
          <span className="font-mono">grudge-asset-convert</span> ·{" "}
          <span className="font-mono">grudge-coder</span> ·{" "}
          <span className="font-mono">grudge-fleet</span>.
        </p>
      </div>
    </div>
  );
}
