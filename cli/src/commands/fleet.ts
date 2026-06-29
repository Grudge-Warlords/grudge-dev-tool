import { ObjectStoreClient } from "../lib/api.js";
import { FLEET_URLS } from "../lib/fleet.js";
import { resolveApiBase } from "../lib/config.js";

export async function runFleet(opts: { json?: boolean }): Promise<number> {
  const apiBase = resolveApiBase();
  const client = new ObjectStoreClient(apiBase);
  try {
    const manifest = await client.fleetManifest();
    if (opts.json) {
      console.log(JSON.stringify({ apiBase, urls: FLEET_URLS, manifest }, null, 2));
      return 0;
    }
    console.log(`\nFleet manifest @ ${apiBase}\n`);
    console.log("  Canonical URLs:");
    for (const [k, v] of Object.entries(FLEET_URLS)) {
      console.log(`    ${k.padEnd(14)} ${v}`);
    }
    console.log("\n  Live manifest:");
    console.log(JSON.stringify(manifest, null, 2));
    return 0;
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : e);
    return 1;
  }
}