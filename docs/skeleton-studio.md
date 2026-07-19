# Skeleton Studio

Admin route: **Skeleton** in the Forge tray app (`/skeleton`).

## Pipeline

1. **Load** FBX / GLB / OBJ  
2. **Extract** — textures + animations (via convert → glTF-Transform)  
3. **AI T-pose** — Blender rest-pose T arms; optional Ollama hint polish  
4. **Place** — click mesh to place Mixamo-25 bone markers (mouse + points)  
5. **Skills** — clips auto-map to Grudge anim skill slots  
6. **Export library** — pack for retarget / R2 upload  

## Mixamo-25 core bones

Hips, Spine, Spine1, Spine2, Neck, Head, L/R Shoulder–Arm–ForeArm–Hand, L/R UpLeg–Leg–Foot–ToeBase.

## Skill slots

`idle` · `walk` · `run` · `strafe_l/r` · `jump` · `attack1/2` · `block` · `shoot` · `cast` · `hit` · `death` · `dodge`

## IPC

```ts
window.grudge.skeleton.extract(path)
window.grudge.skeleton.tpose(path, { aiHint })
window.grudge.skeleton.buildLibrary({ modelPath, mapping, packName })
```

## Requirements

- **FBX2glTF** (bundled under `resources/tools` or PATH)  
- **Blender** for T-pose (set path in Accounts)  
- Optional **Ollama** for AI hint rewrite  

## Retarget runtime

In-game / Forge uses `boneAliases.retargetClips` + mapping JSON. Packs target weapon packs: sword, sword_shield, bow, fire_staff, greataxe, gun.
