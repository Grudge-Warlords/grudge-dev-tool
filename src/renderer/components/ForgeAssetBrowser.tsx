import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Cloud, Loader2, Search } from "lucide-react";
import {
  ASSET_MANIFEST,
  MANIFEST_CATEGORIES,
  TEXTURE_PRESETS,
  manifestByTag,
  type AssetTag,
} from "../../shared/assetManifest";
import { GRUDGE6_ASSET_ROOTS, cdnUrl, type AssetCategory } from "../../shared/grudge6Assets";

type Tab = "cdn" | "r2" | "textures";

interface Props {
  onLoadCdnKey: (key: string) => void;
  onLoadR2Key: (r2Key: string) => void;
  onApplyTexture: (url: string) => void;
}

export default function ForgeAssetBrowser({ onLoadCdnKey, onLoadR2Key, onApplyTexture }: Props) {
  const [tab, setTab] = useState<Tab>("cdn");
  const [cdnTag, setCdnTag] = useState<AssetTag>("all");
  const [query, setQuery] = useState("");
  const [r2Category, setR2Category] = useState<AssetCategory>("characters");
  const r2Root = GRUDGE6_ASSET_ROOTS.find((r) => r.id === r2Category);

  const cdnItems = useMemo(() => {
    const items = manifestByTag(cdnTag);
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      ({ key, entry }) =>
        key.includes(q) || entry.path.toLowerCase().includes(q) || entry.tags?.some((t) => t.includes(q)),
    );
  }, [cdnTag, query]);

  const { data: r2List, isLoading: r2Loading } = useQuery({
    queryKey: ["forge.r2", r2Root?.r2Prefix],
    queryFn: () => window.grudge.os.list({ prefix: r2Root?.r2Prefix ?? "", delimiter: "/", limit: 80 }),
    enabled: tab === "r2" && !!r2Root,
  });

  return (
    <div className="forge-asset-browser">
      <div className="forge-studio-tabs">
        {(["cdn", "r2", "textures"] as Tab[]).map((t) => (
          <button key={t} type="button" className={`forge-studio-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "cdn" ? "CDN" : t === "r2" ? "R2" : "Tex"}
          </button>
        ))}
      </div>

      {tab === "cdn" && (
        <>
          <div className="forge-asset-filters">
            {MANIFEST_CATEGORIES.map((c) => (
              <button key={c.id} type="button" className={`engine-chip${cdnTag === c.id ? " active" : ""}`} onClick={() => setCdnTag(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="forge-asset-search">
            <Search size={12} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter manifest…" />
          </div>
          <ul className="forge-asset-list">
            {cdnItems.map(({ key, entry }) => (
              <li key={key}>
                <button type="button" className="forge-asset-row" onClick={() => onLoadCdnKey(key)} title={entry.path}>
                  <Box size={12} />
                  <span className="forge-asset-name">{key}</span>
                  <span className="forge-asset-meta">{entry.sizeKB ? `${entry.sizeKB}KB` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="forge-asset-foot muted text-[9px]">{Object.keys(ASSET_MANIFEST).length} CDN keys</div>
        </>
      )}

      {tab === "r2" && (
        <>
          <div className="forge-asset-filters">
            {GRUDGE6_ASSET_ROOTS.filter((r) => r.forgeEnabled).map((r) => (
              <button key={r.id} type="button" className={`engine-chip${r2Category === r.id ? " active" : ""}`} onClick={() => setR2Category(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          {r2Loading ? (
            <div className="forge-asset-loading"><Loader2 size={14} className="animate-spin" /> Listing R2…</div>
          ) : (
            <ul className="forge-asset-list">
              {(r2List?.objects ?? []).map((obj: { key: string; size?: number }) => (
                <li key={obj.key}>
                  <button type="button" className="forge-asset-row" onClick={() => onLoadR2Key(obj.key)}>
                    <Cloud size={12} />
                    <span className="forge-asset-name">{obj.key.replace(r2Root?.r2Prefix ?? "", "")}</span>
                  </button>
                </li>
              ))}
              {(r2List?.prefixes ?? []).map((p: string) => (
                <li key={p} className="forge-asset-prefix">{p}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "textures" && (
        <ul className="forge-asset-list">
          {TEXTURE_PRESETS.map((t) => (
            <li key={t.id}>
              <button type="button" className="forge-asset-row" onClick={() => onApplyTexture(t.url)} title={t.url}>
                <span className="forge-asset-name">{t.label}</span>
                <span className="forge-asset-meta">{t.tags.join(", ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function cdnKeyToUrl(key: string): string {
  const entry = ASSET_MANIFEST[key];
  return entry ? cdnUrl(entry.path) : cdnUrl(key);
}