---
layout: default
title: Skeleton Studio
nav_order: 12
description: Mixamo-25 author extract, T-pose, retarget, left/right bind, Toon Bip001 play pack, grudge-convert to CDN.
permalink: /skeleton-studio.html
---

# Skeleton Studio

**Dev Tool route:** `/skeleton` (admin)  
**Product role:** Mixamo-25 **author** wizard → retarget → **Toon Bip001 play** pack → **grudge-convert** → R2/CDN → Warlords / Casting / Forge.

See [Admin architecture](admin-architecture.md).

Do **not** invent a fourth editor. Showcase **O** on Casting stays the live lab bind surface. This tab is the production skeleton / anim editor and deploy tool.

## Two lanes (do not collapse)

| Lane | Skeleton | Use |
|------|----------|-----|
| **Author** | Mixamo-25 (22-core place) | Extract textures/clips, T-pose, click-place, auto-map Mixamo / Bandai / Biped |
| **Play** | Toon RTS **Bip001** 22-core | Warlords race kits `{human,barbarian,elf,dwarf,orc,undead}.glb`. One mixer. Hip **rotation** kept, hip **position** stripped |

Play body is **never** Mixamo Y-Bot, Meshy, capsule, or `30characters.glb` (outline only).

## Bind UX (left / right)

Same pattern as Casting Showcase Anims:

| Side | What |
|------|------|
| **Left** | Warlords **actions** by family: gait · combat · mobility · reaction |
| **Right** | Extracted / retargeted **clips** |
| Bind | Click action, then clip. Session binds ship in `role-binds.json` + `anim-packs-fragment.json` |

Race dropdown loads the Toon play host so you preview clips on the production skeleton.

## Actionable steps

Each step tab **runs or focuses a real pipeline action**:

| Step | What it does |
|------|----------------|
| **Load** | File picker → viewport + one AnimationMixer + skeleton helper |
| **Extract** | `skeleton:extract` (convert FBX if needed, textures + clips) |
| **T-pose** | Blender rest pose via `skeleton:tpose` (+ optional Ollama hint) |
| **Place** | Auto-map Mixamo-25 + click mesh to place bones (snap nearest joint) |
| **Bind** | Roles left · clips right; retarget another pack onto the host |
| **Convert** | Build library v2 stamped `skeleton: bip001` + optional `ingest:convert` |
| **Ship** | Install Documents and/or upload R2 + D1 **index** (not player SSOT) |

Toolbar: **Open model** · **Convert GLB** · **Race** · **Pack**.

## Pipeline

1. Load FBX / GLB / OBJ (author)  
2. Extract — textures + animations  
3. Auto-map — Mixamo / Bip001 / Bandai aliases  
4. T-pose — Blender  
5. Place — Mixamo-25 markers  
6. **Preview on Toon {race}** — rematch/retarget onto Bip001, strip `.position`  
7. Bind roles  
8. Convert → Documents / R2 `models/anims/libraries/`  
9. Merge `anim-packs-fragment.json` into Casting / info.* `anim-packs.json` (defs). Clips stay R2.

## Generic preview body

Clip-only / bones-only files bind to **Toon RTS** unarmed `{race}.glb` (Bip001, SI).

| | |
|--|--|
| Default kit | `assets.grudge-studio.com/asset-packs/toon-rts-characters/glb/characters/human.glb` |
| Visible | `{PREFIX}_Units_head_A` · `Body_B` · `Arms_A` · `Legs_A` (kit voxel weapons hidden) |
| Not | `30characters.glb`, Meshy, capsule, Mixamo Y-Bot as play |
| Clips | Mixamo names rematch via `normalizeBoneKey`; **strip `.position`** |

Code: `src/shared/genericPreviewHost.ts` · `src/renderer/lib/forge/genericPreview.ts`.

## Mixamo-25 author bones

Hips, Spine, Spine1, Spine2, Neck, Head, L/R Shoulder–Arm–ForeArm–Hand, L/R UpLeg–Leg–Foot–ToeBase.

## Play bones (Bip001 22)

`Bip001 Pelvis` · Spine · Spine1 · Spine2 · Neck · Head · L/R Clavicle · UpperArm · Forearm · Hand · L/R Thigh · Calf · Foot · Toe0.

Law: spaced names. No Prop1, no Bip001 root, no Xtra, no Mixamo tracks on the play mixer.

## Weapon / overlay packs

`magic` · `sword_shield` · `longbow` · `pistol` · `rifle` · `polearm` · `2h_melee` · `unarmed` · `locomotion_8way` · `combat_mobility` · `reactions`

Left-column families: gait/8-way · crouch/sneak · combat (incl. greatsword + rifle) · dodge/roll · climb/cover/wall · hit · action/interact.

Cover / wall-hug roles are **desired** until Mixamo clips are extracted. Rifle crouch/sneak/8-way and greatsword jump/heavy/block already have baked JSON.

Plus author aliases: `sword` · `greataxe` · `greatsword` · `samurai` · `bow` · `rifle` · `unarmed` · staff keys.

Cloud hydrate (defs JSON, not Railway):

1. `https://casting.grudge.studio/api/v1/anim-packs.json`
2. `https://assets.grudge-studio.com/prod/anims/_manifest/anim-packs.json`
3. `https://info.grudge-studio.com/api/v1/anim-packs.json`
4. `https://objectstore.grudge-studio.com/api/v1/anim-packs.json`

## Library pack layout (v2)

```
rest.glb
skeleton-mapping.json   # author Mixamo-25 + playSkeleton bip001 + roleBinds
retarget-map.json       # names (Mixamo-25) + playNames (Bip001 → source)
bip001-play-bones.json
role-binds.json
anim-packs-fragment.json
clips-index.json
by-weapon/<pack>.json
textures/
```

## Stores (do not mix)

| Store | Owns |
|-------|------|
| R2 | Clip / rest.glb binaries |
| info.* / Casting `/api/v1` | Role table (`anim-packs.json`) |
| D1 | Asset **index** after upload |
| Railway | Player heroes / bag — **never** anim rows |
| Documents | Local `grudge-anim-libraries` |

## Production contracts

| Rule | Detail |
|------|--------|
| SI scale | ~1.8 m human (dwarf 1.55, orc 2.0) before CDN |
| CDN | `https://assets.grudge-studio.com/...` |
| Play kit | Toon `{race}.glb` via `loadRaceKit` in games |
| Mixer | One `AnimationMixer` |
| Forge | Send **CDN URL**, not only local path |
| UUID | Tag assets via [Grudge UUID](grudge-uuid.md) |

Related: [Object storage](object-storage.md) · [Asset loader](asset-loader-materials.md) · [Systems & APIs](systems-api.md).
