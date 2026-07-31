---
layout: default
title: Skeleton Studio
nav_order: 12
description: Mixamo-25 bone place, T-pose, retarget libraries, grudge-convert to CDN.
permalink: /skeleton-studio.html
---

# Skeleton Studio

**Dev Tool route:** `/skeleton` (admin)  
**Product role:** local retarget pipeline → **grudge-convert** → R2/CDN → Forge.

See [Admin architecture](admin-architecture.md).

## Pipeline

1. **Load** FBX / GLB / OBJ  
2. **Extract** — textures + animations (convert → glTF-Transform)  
3. **Auto-map** — joint names → Mixamo-25 (`autoMapBonesFromNames`: Mixamo, Bip001, CC aliases)  
4. **AI T-pose** — Blender rest-pose T arms; optional Ollama hint polish  
5. **Place** — click mesh to place Mixamo-25 markers (snaps to nearest source bone)  
6. **Retarget** — pull clips from another FBX/GLB onto the loaded character  
7. **Skills** — clips auto-map to Grudge anim skill slots (editable)  
8. **Export library** — pack for retarget / R2 / Documents libraries  
9. **Ship** — bake with grudge-convert → upload → CDN key → open in Forge  

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
