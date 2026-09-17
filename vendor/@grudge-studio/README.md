# Vendored `@grudge-studio/*` dist

These are **built copies** of `F:\GitHub\GrudgeStudioNPM` (`animator` 0.3.1 / `assets` / `core` / `engine` 0.3.2) so CI and packaging do not depend on a sibling checkout. Engine dist includes HOST_STACK + WORLD_DEPLOY from Grok Builder pins (three 0.185.1, Rapier 0.19.3, R3F 9.7).

Do not invent a second locomotion/combat stack here. To refresh:

```
copy GrudgeStudioNPM/packages/<name>/dist → vendor/@grudge-studio/<name>/dist
```

Source of truth remains the npm monorepo.
