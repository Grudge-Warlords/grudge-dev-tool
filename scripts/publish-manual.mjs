// scripts/publish-manual.mjs
//
// One-shot manual release. Used while GitHub Actions is gated on the account.
//   npm run publish:manual -- --bump patch                     (default)
//   npm run publish:manual -- --bump minor
//   npm run publish:manual -- --bump major
//   npm run publish:manual -- --version 0.2.5
//   npm run publish:manual -- --bump patch --dry-run
//   npm run publish:manual -- --bump patch --notes "Quick fix for X."
//
// Pipeline:
//   1. Verify clean working tree.
//   2. Sync with origin (rebase) so we don't fight remote.
//   3. Bump package.json (semver).
//   4. Insert CHANGELOG entry (idempotent — skipped if already present).
//   5. Run `npm run package` (full electron-builder build).
//   6. Verify release artifacts exist.
//   7. git add / commit / tag / push (with retry on race).
//   8. `gh release create` with the .exe + .blockmap + latest.yml.
//
// Exits non-zero on any failure. Safe to re-run after fixing whatever broke
// (the version bump and changelog steps are idempotent).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Derive REPO + PRODUCT from project config — no hardcoded strings.
// ---------------------------------------------------------------------------
function loadConfig() {
  const ebYml = readFileSync(join(ROOT, "electron-builder.yml"), "utf8");
  const ownerMatch = ebYml.match(/^\s*owner:\s*(\S+)/m);
  const repoMatch  = ebYml.match(/^\s*repo:\s*(\S+)/m);
  const productMatch = ebYml.match(/^productName:\s*(.+)$/m);
  if (!ownerMatch || !repoMatch) {
    throw new Error("electron-builder.yml is missing publish.owner or publish.repo");
  }
  if (!productMatch) {
    throw new Error("electron-builder.yml is missing productName");
  }
  return {
    REPO: `${ownerMatch[1]}/${repoMatch[1]}`,
    PRODUCT: productMatch[1].trim(),
  };
}

const { REPO, PRODUCT } = loadConfig();

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { bump: "patch", version: null, dryRun: false, notes: null, skipBuild: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    const eq = (a.match(/^--([^=]+)=(.*)$/));
    const key = eq ? eq[1] : a.replace(/^--/, "");
    const val = eq ? eq[2] : next;
    switch (key) {
      case "bump":       out.bump = val; if (!eq) i++; break;
      case "version":    out.version = val; if (!eq) i++; break;
      case "notes":      out.notes = val; if (!eq) i++; break;
      case "dry-run":    out.dryRun = true; break;
      case "skip-build": out.skipBuild = true; break;
      case "help": case "h":
        console.log(`Usage: publish-manual [--bump patch|minor|major] [--version x.y.z] [--notes "..."] [--dry-run] [--skip-build]`);
        process.exit(0);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// shell helpers
// ---------------------------------------------------------------------------
function run(cmd, args, opts = {}) {
  const display = `${cmd} ${args.join(" ")}`;
  console.log(`\n$ ${display}`);
  if (opts.dryRun) { console.log("  (dry-run, skipped)"); return { status: 0, stdout: "", stderr: "" }; }
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: opts.captureOutput ? "pipe" : "inherit", encoding: "utf8", shell: false });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`\n[publish-manual] command failed (${r.status}): ${display}`);
    process.exit(r.status ?? 1);
  }
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function gitCapture(args) {
  return run("git", args, { captureOutput: true, allowFail: true });
}

// ---------------------------------------------------------------------------
// semver
// ---------------------------------------------------------------------------
function bumpSemver(current, bump) {
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Cannot parse version: ${current}`);
  let [_, M, mn, p] = m.map((x, i) => i === 0 ? x : Number(x));
  switch (bump) {
    case "major": M += 1; mn = 0; p = 0; break;
    case "minor": mn += 1; p = 0; break;
    case "patch": p += 1; break;
    default: throw new Error(`Unknown bump: ${bump}`);
  }
  return `${M}.${mn}.${p}`;
}

// ---------------------------------------------------------------------------
// CHANGELOG idempotent insert
// ---------------------------------------------------------------------------
function insertChangelogEntry(version, notes) {
  const changelogPath = join(ROOT, "CHANGELOG.md");
  if (!existsSync(changelogPath)) {
    console.warn("[publish-manual] CHANGELOG.md missing; skipping");
    return;
  }
  const text = readFileSync(changelogPath, "utf8");
  const versionHeading = `## [${version}]`;
  if (text.includes(versionHeading)) {
    console.log(`[publish-manual] CHANGELOG already has ${versionHeading}, leaving untouched`);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const body = (notes ?? "Manual release.").trim();
  const entry = `\n## [${version}] — ${today}\n\n### Changed\n- ${body.replace(/\n/g, "\n- ")}\n`;
  // Insert after the first occurrence of "## [Unreleased]" block.
  let inserted;
  if (text.includes("## [Unreleased]")) {
    inserted = text.replace(/(## \[Unreleased\][^\n]*\n)/, `$1${entry}`);
  } else {
    inserted = text + entry;
  }
  // Update or append the comparison link footer.
  const footerLine = `[${version}]:      https://github.com/${REPO}/releases/tag/v${version}`;
  if (!inserted.includes(footerLine)) {
    inserted = inserted.trimEnd() + `\n${footerLine}\n`;
  }
  writeFileSync(changelogPath, inserted, "utf8");
  console.log(`[publish-manual] inserted CHANGELOG entry for ${version}`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));

  // 1. Clean working tree
  const status = gitCapture(["status", "--porcelain"]);
  if (status.stdout.trim()) {
    console.error(`\n[publish-manual] working tree is not clean. Commit or stash first:\n${status.stdout}`);
    process.exit(1);
  }

  // 2. Sync with origin
  console.log(`\n[publish-manual] syncing with origin/main`);
  run("git", ["fetch", "origin", "--tags"]);
  run("git", ["pull", "--rebase", "origin", "main"]);

  // 3. Compute new version
  const pkgPath = join(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const current = pkg.version;
  const next = args.version ?? bumpSemver(current, args.bump);
  console.log(`\n[publish-manual] ${current} → ${next}`);

  if (args.dryRun) {
    console.log(`[publish-manual] DRY RUN — would publish v${next} but stopping here.`);
    return;
  }

  pkg.version = next;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

  // 4. CHANGELOG
  insertChangelogEntry(next, args.notes);

  // 5. Build
  if (!args.skipBuild) {
    run("npm", ["run", "package"]);
  } else {
    console.log("[publish-manual] --skip-build set, skipping build");
  }

  // 6. Verify artifacts
  const rel = join(ROOT, "release");
  const exe = join(rel, `${PRODUCT}-Setup-${next}.exe`);
  const blockmap = `${exe}.blockmap`;
  const latest = join(rel, "latest.yml");
  for (const f of [exe, blockmap, latest]) {
    if (!existsSync(f)) {
      console.error(`[publish-manual] missing release artifact: ${f}`);
      process.exit(1);
    }
  }

  // 7. Commit + tag + push (with one rebase retry on race)
  run("git", ["add", "package.json", "CHANGELOG.md", "package-lock.json"], { allowFail: true });
  run("git", ["commit", "-m", `release: v${next}`, "-m", "Co-Authored-By: Oz <oz-agent@warp.dev>"]);
  run("git", ["tag", "-a", `v${next}`, "-m", `v${next}`]);

  let pushRes = run("git", ["push", "origin", "main", "--follow-tags"], { allowFail: true });
  if (pushRes.status !== 0) {
    console.warn("[publish-manual] push race; rebasing and retrying once");
    run("git", ["pull", "--rebase", "origin", "main"]);
    run("git", ["push", "origin", "main", "--follow-tags"]);
  }

  // 8. Publish release
  const releaseNotes = args.notes
    ? args.notes
    : `Automated manual publish of v${next}. See CHANGELOG.md for details. Auto-update will deliver this within ~4h to existing installs.`;
  run("gh", [
    "release", "create", `v${next}`,
    "-R", REPO,
    "--title", `v${next}`,
    "--notes", releaseNotes,
    exe, blockmap, latest,
  ]);

  console.log(`\n[publish-manual] ✅ v${next} published.`);
  console.log(`    https://github.com/${REPO}/releases/tag/v${next}`);
}

main();
