import { ObjectStoreClient } from "../lib/api.js";
import { resolveApiBase } from "../lib/config.js";

export async function runSearch(opts: {
  q?: string;
  pack?: string;
  category?: string;
  apiBase?: string;
  json?: boolean;
}): Promise<number> {
  const client = new ObjectStoreClient(resolveApiBase(opts.apiBase));
  const res = await client.search({
    q: opts.q,
    pack: opts.pack,
    category: opts.category,
  });
  if (opts.json) {
    console.log(JSON.stringify(res, null, 2));
    return 0;
  }
  console.log(`\n${res.count} results\n`);
  for (const item of res.items.slice(0, 50)) {
    console.log(`  ${item.path}  [${item.category}] ${item.grudgeUUID}`);
  }
  return 0;
}