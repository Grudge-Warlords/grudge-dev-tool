---
layout: default
title: Skeleton Studio
nav_order: 12
description: Mixamo-25 bone place, T-pose, retarget libraries, grudge-convert to CDN.
permalink: /skeleton-studio.html
---

# Skeleton Studio

**Dev Tool route:** `/skeleton` (admin)  
**Product role:** **wired** Mixamo-25 wizard → **grudge-convert** → R2/CDN → Forge.

See [Admin architecture](admin-architecture.md).

## Actionable steps (not labels)

Each step tab **runs or focuses a real pipeline action**:

| Step | What it does |
|------|----------------|
| **Load** | File picker → viewport + AnimationMixer + skeleton helper |
| **Extract** | `skeleton:extract` (convert FBX if needed, textures + clips) |
| **T-pose** | Blender rest pose via `skeleton:tpose` (+ optional Ollama hint) |
| **Place** | Auto-map Mixamo-25 + click mesh to place bones (snap nearest joint) |
| **Skills** | Clip → skill slot map; retarget clips from another pack |
| **Export** | Build library v2 → install Documents and/or upload R2 |
| **Libraries** | Local packs + fleet `models/anims` search |

Toolbar always: **Open model** · **Convert GLB** (`ingest:convert`).

## Pipeline

1. **Load** FBX / GLB / OBJ  
2. **Extract** — textures + animations  
3. **Auto-map** — Mixamo / Bip001 / CC aliases  
4. **T-pose** — Blender  
5. **Place** — Mixamo-25 markers  
6. **Skills / retarget**  
7. **Export** → Documents / R2 `models/anims/libraries/`  
8. **Ship** — CDN → open in Forge

## Mixamo-25 core bones

Hips, Spine, Spine1, Spine2, Neck, Head, L/R Shoulder–Arm–ForeArm–Hand, L/R UpLeg–Leg–Foot–ToeBase.

## Skill slots

`idle` · `walk` · `run` · `strafe_l/r` · `jump` · `attack1/2` · `block` · `shoot` · `cast` · `hit` · `death` · `dodge`

## Weapon / anim packages

Exported packs include `by-weapon/<pack>.json` for:

`sword` · `sword_shield` · `greataxe` · `greatsword` · `samurai` · `bow` · `longbow` · `crossbow` · `gun` · `rifle` · `fire_staff` · `dark_staff` · `focus` · `magic` · `unarmed`

## Library pack layout (v2)

```
rest.glb
skeleton-mapping.json   # placements + boneMap + reverseMap
retarget-map.json       # SkeletonUtils names: targetBone → sourceBone
clips-index.json
textures/
clips/
```

## Production contracts

| Rule | Detail |
|------|--------|
| SI scale | ~1.8 m human before CDN |
| CDN | `https://assets.grudge-studio.com/...` |
| Index | ObjectStore / D1 after upload |
| Forge | Send **CDN URL**, not only local path |
| UUID | Tag assets via [Grudge UUID](grudge-uuid.md) |

Related: [Object storage](object-storage.md) · [Asset loader](asset-loader-materials.md) · [Systems & APIs](systems-api.md).
