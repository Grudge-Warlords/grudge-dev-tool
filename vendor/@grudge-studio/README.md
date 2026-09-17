# Vendored `@grudge-studio/*` dist

These are **built copies** of `F:\GitHub\GrudgeStudioNPM` (`animator` / `assets` / `core` / `engine`) so CI and packaging do not depend on a sibling checkout.

Do not invent a second locomotion/combat stack here. To refresh:

```
copy GrudgeStudioNPM/packages/<name>/dist → vendor/@grudge-studio/<name>/dist
```

Source of truth remains the npm monorepo.
