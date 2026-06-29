/** Normalize ONE TRUTH objectstore catalog JSON into storefront cards. */

export interface StoreCatalogItem {
  id: string;
  name: string;
  path?: string;
  thumbnail?: string;
  category?: string;
  pack?: string;
  tier?: string;
  slot?: string;
  price?: number;
  description?: string;
  tags?: string[];
  raw: unknown;
}

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function itemFromRecord(rec: Record<string, unknown>, fallbackId: string): StoreCatalogItem | null {
  const name =
    asString(rec.name) ??
    asString(rec.displayName) ??
    asString(rec.title) ??
    asString(rec.label);
  if (!name) return null;

  const id =
    asString(rec.id) ??
    asString(rec.uuid) ??
    asString(rec.sku) ??
    asString(rec.objectPath) ??
    fallbackId;

  const path =
    asString(rec.path) ??
    asString(rec.objectPath) ??
    asString(rec.key) ??
    asString(rec.cdnPath) ??
    asString(rec.modelPath);

  const thumbnail =
    asString(rec.thumbnail) ??
    asString(rec.thumb) ??
    asString(rec.icon) ??
    asString(rec.preview) ??
    asString(rec.image);

  const tags = Array.isArray(rec.tags)
    ? rec.tags.map((t) => String(t)).filter(Boolean)
    : undefined;

  return {
    id,
    name,
    path,
    thumbnail,
    category: asString(rec.category) ?? asString(rec.type) ?? asString(rec.group),
    pack: asString(rec.pack) ?? asString(rec.assetPack) ?? asString(rec.collection),
    tier: asString(rec.tier) ?? asString(rec.rarity),
    slot: asString(rec.slot) ?? asString(rec.equipSlot),
    price: asNumber(rec.price) ?? asNumber(rec.cost),
    description: asString(rec.description) ?? asString(rec.desc),
    tags,
    raw: rec,
  };
}

function collectArrays(data: unknown, out: unknown[]): void {
  if (!data) return;
  if (Array.isArray(data)) {
    out.push(...data);
    return;
  }
  if (typeof data !== "object") return;
  const obj = data as Record<string, unknown>;
  for (const key of ["items", "catalog", "products", "assets", "entries", "data", "results"]) {
    const v = obj[key];
    if (Array.isArray(v)) out.push(...v);
    else if (v && typeof v === "object") collectArrays(v, out);
  }
  // Category-keyed maps: { weapons: [...], ships: [...] }
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) out.push(...v);
  }
}

/** Flatten assorted catalog JSON shapes into uniform store items. */
export function normalizeCatalogItems(data: unknown): StoreCatalogItem[] {
  const raw: unknown[] = [];
  collectArrays(data, raw);
  const items: StoreCatalogItem[] = [];
  const seen = new Set<string>();

  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return;
    const rec = entry as Record<string, unknown>;
    const parsed = itemFromRecord(rec, `item-${i}`);
    if (!parsed) return;
    const key = `${parsed.id}::${parsed.path ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(parsed);
  });

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export type StoreGroupingKey = "category" | "pack" | "tier" | "slot";

export function groupCatalogItems(
  items: StoreCatalogItem[],
  key: StoreGroupingKey,
): Array<{ label: string; items: StoreCatalogItem[] }> {
  const map = new Map<string, StoreCatalogItem[]>();
  for (const item of items) {
    const label = (item[key] ?? "Uncategorized").trim() || "Uncategorized";
    const bucket = map.get(label) ?? [];
    bucket.push(item);
    map.set(label, bucket);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, group]) => ({ label, items: group }));
}

export function catalogItemThumb(
  item: StoreCatalogItem,
  cdnBase: string,
  categoryPrefix?: string,
): string | null {
  if (item.thumbnail) {
    if (/^https?:\/\//i.test(item.thumbnail)) return item.thumbnail;
    return `${cdnBase.replace(/\/$/, "")}/${item.thumbnail.replace(/^\//, "")}`;
  }
  if (item.path) {
    const p = item.path.replace(/^\//, "");
    if (/\.(png|jpe?g|webp|gif|svg)$/i.test(p)) {
      return `${cdnBase.replace(/\/$/, "")}/${p}`;
    }
    const base = p.replace(/\.[^.]+$/, "");
    const guesses = [`${base}.png`, `${base}-thumb.png`, `${base}/thumb.png`];
    if (categoryPrefix) guesses.unshift(`${categoryPrefix}${base}.png`);
    return `${cdnBase.replace(/\/$/, "")}/${guesses[0]}`;
  }
  return null;
}

export function isModelPath(path: string): boolean {
  return /\.(glb|gltf|fbx|obj|stl|dae|3mf|blend)$/i.test(path);
}