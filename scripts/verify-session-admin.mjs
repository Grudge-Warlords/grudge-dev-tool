#!/usr/bin/env node
/**
 * scripts/verify-session-admin.mjs
 *
 * Verifies the stored Puter session matches the admin allowlist
 * (grudachain / molochdadev + emails). Never prints secrets — only identity
 * fields and boolean match results.
 *
 * Usage: node scripts/verify-session-admin.mjs
 * Exit 0 = signed-in admin; 2 = signed-in customer; 3 = no session; 1 = error
 */

import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SERVICE = "grudge-dev-tool";

const CANONICAL_USERNAMES = new Set(["grudachain", "molochdadev"]);
const CANONICAL_EMAILS = new Set(["grudgedev@gmail.com", "jonbemmons@gmail.com"]);

function loadEnvAdminExtras() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^VITE_ADMIN_USERNAMES\s*=\s*(.*)$/);
    if (m) {
      for (const u of m[1].split(",")) {
        const t = u.trim().toLowerCase();
        if (t) CANONICAL_USERNAMES.add(t);
      }
    }
    const e = line.match(/^VITE_ADMIN_EMAILS\s*=\s*(.*)$/);
    if (e) {
      for (const u of e[1].split(",")) {
        const t = u.trim().toLowerCase();
        if (t) CANONICAL_EMAILS.add(t);
      }
    }
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function main() {
  loadEnvAdminExtras();
  let keytar;
  try {
    keytar = (await import("keytar")).default;
  } catch {
    console.error("[verify-session-admin] keytar missing — npm install first");
    process.exit(1);
  }

  const token = await keytar.getPassword(SERVICE, "puter-token");
  const userRaw = await keytar.getPassword(SERVICE, "puter-user");
  const gidRaw = await keytar.getPassword(SERVICE, "grudge-id");

  console.log("\nGrudge Dev Tool · session + admin audit\n");
  console.log("  Allowlist usernames:", [...CANONICAL_USERNAMES].join(", "));
  console.log("  Allowlist emails:   ", [...CANONICAL_EMAILS].join(", "));
  console.log("");

  if (!token) {
    console.log("  ✗ No puter-token in vault — open app and sign in as grudachain or molochdadev");
    process.exit(3);
  }
  console.log("  ✓ puter-token present (", token.length, "chars )");

  const user = userRaw ? safeJson(userRaw) : null;
  const username = String(user?.username ?? user?.user?.username ?? "").toLowerCase();
  const email = String(user?.email ?? user?.user?.email ?? "").toLowerCase();
  const uuid = String(user?.uuid ?? user?.user?.uuid ?? "");
  console.log("  username:", username || "(missing)");
  console.log("  email:   ", email || "(missing)");
  console.log("  uuid:    ", uuid ? uuid.slice(0, 8) + "…" : "(missing)");

  const gid = gidRaw ? safeJson(gidRaw) : null;
  const grudgeId = gid?.grudgeId ?? (typeof gidRaw === "string" && gidRaw.startsWith("grudge-") ? gidRaw : null);
  console.log("  grudgeId:", grudgeId ? String(grudgeId).slice(0, 20) + "…" : "(missing)");

  const userOk = username && CANONICAL_USERNAMES.has(username);
  const emailOk = email && CANONICAL_EMAILS.has(email);
  console.log("");
  console.log("  admin by username:", userOk ? "YES" : "no");
  console.log("  admin by email:   ", emailOk ? "YES" : "no");

  // Live whoami against Puter if possible
  try {
    const res = await fetch("https://api.puter.com/whoami", {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log("  Puter /whoami:    ", res.status, res.ok ? "OK" : "FAIL");
    if (res.ok) {
      const body = await res.json();
      const liveUser = String(body?.username ?? body?.user?.username ?? "").toLowerCase();
      console.log("  live username:    ", liveUser || "(none)");
      if (liveUser && liveUser !== username) {
        console.log("  ⚠ vault username differs from live whoami — re-login recommended");
      }
    }
  } catch (err) {
    console.log("  Puter /whoami:     network error —", err.message);
  }

  // Fleet client health
  try {
    const bases = [
      "https://client.grudge-studio.com",
      "https://id.grudge-studio.com",
      "https://assets.grudge-studio.com",
      "https://objectstore.grudge-studio.com",
      "https://ai.grudge-studio.com",
      "https://forge.grudge-studio.com",
    ];
    console.log("\n  Connectivity:");
    for (const url of bases) {
      const t0 = Date.now();
      try {
        const r = await fetch(url, { method: "GET", redirect: "follow" });
        console.log(`    ✓ ${url.replace("https://", "").padEnd(36)} ${r.status}  ${Date.now() - t0}ms`);
      } catch (e) {
        console.log(`    ✗ ${url.replace("https://", "").padEnd(36)} ${e.message}`);
      }
    }
  } catch { /* ignore */ }

  console.log("");
  if (userOk || emailOk) {
    console.log("✅ Session is ADMIN (grudachain / molochdadev allowlist).");
    console.log("   Admin tabs: Upload · Request · BlenderKit · Legion · Forge · Skeleton · Play · Coder · Preview · Settings");
    process.exit(0);
  }
  if (username || token) {
    console.log("⚠ Signed in as customer — not on admin allowlist.");
    console.log("   Sign in as grudachain or molochdadev for full Forge admin surface.");
    process.exit(2);
  }
  process.exit(3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
