#!/usr/bin/env node
// scripts/verify-creds.mjs
// Audits the Windows Credential Vault entries the dev tool needs at runtime.
// Prints PRESENCE + LENGTH ONLY — values are never echoed.
//
// Usage: node scripts/verify-creds.mjs

const SERVICE = "grudge-dev-tool";

// Map: human label -> keytar account name. Mirrors src/main/cf/credentials.ts
// CF_ACCOUNTS and src/main/api.ts / blenderkit/daemon.ts account names.
const REQUIRED = [
  // Cloudflare R2 — direct S3 path (the canonical primary backend)
  ["R2 endpoint",       "cf-r2-endpoint",       true],
  ["R2 access key id",  "cf-r2-access-key-id",  true],
  ["R2 secret",         "cf-r2-secret",         true],
  ["R2 bucket",         "cf-r2-bucket",         true],
  ["R2 region",         "cf-r2-region",         false],
  ["R2 public URL",     "cf-r2-public-url",     false],
  ["R2 public r2.dev",  "cf-r2-public-r2-url",  false],
  // Cloudflare Worker — fallback object-store path
  ["Worker URL",        "cf-objectstore-worker-url", false],
  ["Worker API key",    "cf-objectstore-api-key",    false],
  // AI Gateway / Workers AI
  ["CF account id",     "cf-account-id",        false],
  ["AI gateway id",     "cf-ai-gateway-id",     false],
  ["AI Workers token",  "cf-ai-workers-api",    false],
  // Grudge backend overrides + identity
  ["game-api base",     "default.apiBaseUrl",   false],
  ["assets-api base",   "default.assetsApiBaseUrl", false],
  ["Grudge bearer",     "default",              false],
  // Puter session (set on first sign-in)
  ["Puter token",       "puter-token",          false],
  ["Puter user",        "puter-user",           false],
  ["Grudge ID record",  "grudge-id",            false],
  // BlenderKit (optional)
  ["BlenderKit key",    "blenderkit-api-key",   false],
];

async function main() {
  let keytar;
  try {
    keytar = (await import("keytar")).default;
  } catch (err) {
    console.error("[verify-creds] keytar not available — run `npm install` first.");
    process.exit(1);
  }

  let okRequired = 0;
  let missingRequired = 0;
  let okOptional = 0;

  console.log(`\nGrudge Dev Tool · credential vault audit (service='${SERVICE}')\n`);
  console.log("  status    chars  required  account                          label");
  console.log("  ────────  ─────  ────────  ───────────────────────────────  ──────────────────────────");

  for (const [label, account, required] of REQUIRED) {
    const v = await keytar.getPassword(SERVICE, account);
    const has = v != null && v.length > 0;
    const status = has ? "✓ stored " : "✗ missing";
    const len = has ? String(v.length).padStart(5) : "    —";
    const req = required ? " required" : " optional";
    console.log(`  ${status}  ${len}  ${req}  ${account.padEnd(31)}  ${label}`);
    if (required) {
      if (has) okRequired++;
      else missingRequired++;
    } else if (has) {
      okOptional++;
    }
  }

  console.log("");
  console.log(`Required:  ${okRequired} stored, ${missingRequired} missing`);
  console.log(`Optional:  ${okOptional} stored`);
  console.log("");

  if (missingRequired > 0) {
    console.log("⚠ Required entries are missing. Re-run `npm run secret:import <path-to-.env>`");
    console.log("  with a file containing the OBJECT_STORAGE_* canonical names.");
    process.exit(2);
  }
  console.log("✅ All required runtime credentials are present in the Credential Vault.");
  console.log("   The installed dev tool will resolve them on next launch.");
}

main().catch((err) => {
  console.error("[verify-creds] failed:", err.message);
  process.exit(1);
});
