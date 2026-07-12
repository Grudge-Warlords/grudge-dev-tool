---
layout: default
title: Grudge UUID
nav_order: 4
---

# Grudge UUID — Asset & inventory identity

Grudge UUID is the **stable id** for understanding an asset or item across every Grudge Studio surface (Dev Tool Browser, Forge, Warlords, inventory, Treaty-linked accounts).

## Two mint modes

| Mode | Function | When |
|------|----------|------|
| **Stable asset** | `generateStableAssetUUID` / registry `uuidForAssetPath` | CDN / R2 objects, models, icons, VFX, textures — **same path → same UUID forever** |
| **Instance / drop** | `generateGrudgeUUID` | Crafted loot, timed drops, one-off inventory instances (unique each mint) |

### Format (both modes)

`SLOT-TIER-ITEMID-STAMP-COUNTER`

- **SLOT** (4 chars) — type code (`mesh`, `texr`, `char`, `vfxa`, …)
- **TIER** (2 chars) — `t0`–`t8` or `oo`
- **ITEMID** (4 digits)
- **STAMP** (12) + **COUNTER** (6) — for stable assets: hash-derived (not wall clock)

### Stable asset algorithm

```
path = normalize(R2 key)           # no host, no leading slash
hex  = sha256("grudge-asset-v1:" + path)
uuid = SLOT-oo-ITEMID-STAMP-COUNTER  // fields carved from hex
```

Re-running **Index all** never renames an asset. Content re-uploads keep the same UUID as long as the **object key** is unchanged (inventory links stay valid). Content integrity is stored separately as optional `sha256` on the registry entry.

## Global registry (SSOT)

| | |
|--|--|
| **R2 key** | `manifests/grudge-asset-registry/v1/index.json` |
| **Maps** | `byPath[key] → entry`, `byUuid[uuid] → path` |
| **Entry** | `{ grudgeUUID, path, family, slot, contentType, sizeBytes, sha256?, updatedAt, source }` |

### Dev Tool

- **Browser → Index folder / Index all** — walks R2 and upserts every object into the registry.
- File cards show the UUID; copy via fingerprint button.
- **IPC** `window.grudge.registry.*` — `getByPath`, `getByUuid`, `resolve`, `backfill`, `uuidForPath`.

### Games / inventory

```ts
// Resolve UUID → CDN URL (Studio main or your own client of the registry JSON)
const { publicCdn, path, grudgeUUID } = await registry.resolve(uuid);
// Or load manifests/grudge-asset-registry/v1/index.json from CDN and index client-side
```

Use **stable asset UUIDs** on:

- Equipment paperdoll / model3d mesh slots  
- Inventory stacks that reference a catalog item  
- Scene entity `model.url` aliases (`builtin:…` can map via registry)  
- VFX / icon catalogs  

Use **instance UUIDs** when each drop must be unique (soulbound gear, crafted rare).

## Slot codes (asset-oriented)

| Code | Meaning |
|------|---------|
| `texr` | Texture |
| `mati` | Material / PBR map |
| `mdlb` | Blend / converted model |
| `mesh` | Mesh / GLB |
| `sprt` | Sprite |
| `icon` | UI / ability icon |
| `vfxa` | VFX |
| `anim` | Animation pack |
| `mapa` | Map / environment |
| `char` | Character / race kit |
| `wepm` | Weapon mesh |
| `audi` | Audio |

Path heuristics (`inferAssetSlot`) assign these from prefixes like `models/grudge6/races/`, `textures/`, `vfx/`, etc.

## Cross-deploy contract

1. **Identity** = Grudge UUID (stable asset or instance).  
2. **Location** = R2 path + public CDN base `https://assets.grudge-studio.com/`.  
3. **Registry** = single JSON index (or future sharded index under the same prefix).  

All Studio apps should resolve assets by UUID first, path second — never by host-specific absolute URL alone.

## Examples

| Asset | Grudge UUID (illustrative) |
|-------|----------------------------|
| `models/grudge6/races/WK_Characters.glb` | `char-oo-####-xxxxxxxxxxxx-xxxxxx` (stable) |
| Player crafts a sword drop | `swrd-t3-0042-<time>-<counter>` (instance) |
