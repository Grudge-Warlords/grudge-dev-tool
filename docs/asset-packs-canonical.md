# Asset Packs — Canonical Registry
The single source of truth for every asset pack the dev tool knows about. Anything not in this list cannot be uploaded under `asset-packs/`. Add a new pack ⇒ add a row here in the same PR.
## Bucket taxonomy (locked)
```
asset-packs/<pack-id>/v<version>/<category>/<file>          # source assets
asset-packs/<pack-id>/v<version>/_thumbs/<category>/<file>  # 256px JPEG thumbnails
asset-packs/<pack-id>/v<version>/_originals/<category>/...  # only when --keep-source
asset-packs/<pack-id>/v<version>/_blends/<category>/...     # raw .blend kept alongside .glb
asset-packs/<pack-id>/manifest.json                         # full catalog with Grudge UUIDs
asset-packs/<pack-id>/CHANGELOG.txt                         # provenance
asset-packs/<pack-id>/README.txt                            # license + author
```
Public CDN mirror: `https://assets.grudge-studio.com/asset-packs/<pack-id>/v<version>/...`
## Conventions
- **`<pack-id>`** is lower-kebab. No spaces, no version, no scope.
- **`<version>`** is the upstream pack version, prefixed with `v` in the bucket only.
- **License** must be permissive (`CC0`, `CC-BY`, `MIT`, `Apache-2.0`) or explicit Grudge-owned.
- **Author** field carries the upstream creator. Grudge-owned packs use `Grudge Studio`.
- Packs without a clear license go to `dev/private/<pack-id>/` instead.
## Registered packs
### `classic64` v0.6 — Classic 64 Asset Library
- License: **CC0**
- Author: **Craig Snedeker**
- Source: <https://craigsnedeker.itch.io/>
- On-disk source: `C:\Users\nugye\Documents\- Classic 64 Asset Pack 0.6\- Classic 64 Asset Pack 0.6\`
- Disk size: **102.41 MB**, **872 files** (732 image · 130 model · 6 other · 4 doc)
- Bucket prefix: `asset-packs/classic64/v0.6/`
- Public CDN root: `https://assets.grudge-studio.com/asset-packs/classic64/v0.6/`
- Categories (top 10 by file count): `Ground` (89) · `Misc` (79) · `Food` (77) · `Wood` (66) · `Metal` (57) · `Rocks` (37) · `Signs` (37) · `Walls` (37) · `Nature` (36) · `Windows` (36)
- Status: **dry-run complete** (`grudge-dev-tool/classic64-dry-run.json`); upload pending backend deploy
## How to add a pack
1. Drop the pack in a writable on-disk location.
2. Run `npm run upload-pack -- --root <path> --pack-id <id> --version <ver> --license <SPDX> --author "<name>" --dry-run`.
3. Inspect the dry-run JSON in `grudge-dev-tool/manifest-preview-<id>.json`.
4. Add the row above (in alpha order by `<pack-id>`).
5. Re-run without `--dry-run`. The CLI calls `/api/objectstore/upload-url` per file, then `/api/objectstore/manifest` at the end.
6. Verify on the **Browser** page that `asset-packs/<id>/v<ver>/` is populated.
