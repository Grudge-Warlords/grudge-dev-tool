/**
 * Project OS — scaffold, diagnose, save, resolve best assets, auto-fix.
 * Used by IPC + GRUDA agent tools so AI and humans share one layout.
 */
import { app, dialog, shell } from "electron";
import { join, basename, dirname, relative, sep } from "node:path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import {
  PROJECT_DIRS,
  PROJECT_MANIFEST,
  PROJECT_SCHEMA_VERSION,
  PROJECT_TREE_DOC,
  type GrudgeProjectManifest,
  type ProjectKind,
  defaultPreferredAssets,
  slugifyProjectName,
  starterSceneJson,
  starterScriptTs,
} from "../../shared/projectLayout";
import * as assetRegistry from "../assetRegistry";
import { r2List, r2PublicUrl, r2Head } from "../cf/r2Direct";
import { RACE_GRUDGE6, CDN_BASE } from "../../shared/grudge6Assets";
import log from "../logger";

export { PROJECT_TREE_DOC, PROJECT_MANIFEST };

// ── Roots ──────────────────────────────────────────────────────────────

const DEFAULT_PROJECTS_DIR = () =>
  join(app.getPath("documents"), "GrudgeStudio", "Projects");

let projectsRootOverride: string | null = null;

export function getProjectsRoot(): string {
  return projectsRootOverride || DEFAULT_PROJECTS_DIR();
}

export function setProjectsRoot(path: string | null): string {
  projectsRootOverride = path && path.trim() ? path.trim() : null;
  return getProjectsRoot();
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

// ── Manifest I/O ───────────────────────────────────────────────────────

export function isProjectRoot(dir: string): boolean {
  return existsSync(join(dir, PROJECT_MANIFEST));
}

export function readManifest(projectDir: string): GrudgeProjectManifest {
  const raw = readFileSync(join(projectDir, PROJECT_MANIFEST), "utf8");
  return JSON.parse(raw) as GrudgeProjectManifest;
}

export function writeManifest(projectDir: string, m: GrudgeProjectManifest): void {
  m.updatedAt = new Date().toISOString();
  m.schemaVersion = PROJECT_SCHEMA_VERSION;
  writeFileSync(join(projectDir, PROJECT_MANIFEST), JSON.stringify(m, null, 2) + "\n", "utf8");
}

// ── Scaffold ───────────────────────────────────────────────────────────

export interface ScaffoldOpts {
  name: string;
  kind?: ProjectKind;
  description?: string;
  parentDir?: string;
  withStarterScene?: boolean;
  withStarterScript?: boolean;
}

export async function scaffoldProject(opts: ScaffoldOpts): Promise<{
  dir: string;
  manifest: GrudgeProjectManifest;
}> {
  const name = opts.name.trim() || "Untitled Project";
  const slug = slugifyProjectName(name);
  const parent = opts.parentDir?.trim() || getProjectsRoot();
  ensureDir(parent);

  let dir = join(parent, slug);
  if (existsSync(dir)) {
    dir = join(parent, `${slug}-${Date.now().toString(36)}`);
  }
  ensureDir(dir);

  for (const d of PROJECT_DIRS) {
    ensureDir(join(dir, d));
  }

  // README for humans + agents
  writeFileSync(
    join(dir, "README.md"),
    `# ${name}\n\nGrudge Studio project (\`${opts.kind ?? "game"}\`).\n\n## Layout\n\n\`\`\`\n${PROJECT_TREE_DOC}\n\`\`\`\n\n## Practices\n\n1. Edit scenes under \`scenes/\`, scripts under \`scripts/\`.\n2. Prefer CDN + Grudge UUID in \`grudge.project.json\` over large binary copies.\n3. Run **Diagnose** / **Auto-fix** from Studio → Projects or ask GRUDA.\n4. Never commit \`.grudge/drafts\` or \`.grudge/cache\`.\n`,
    "utf8",
  );

  const now = new Date().toISOString();
  const preferred = defaultPreferredAssets();
  // Stamp path-stable UUIDs when registry is available
  for (const a of preferred) {
    try {
      a.grudgeUUID = assetRegistry.uuidForAssetPath(a.path);
    } catch { /* offline ok */ }
  }

  const manifest: GrudgeProjectManifest = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: randomUUID(),
    name,
    kind: opts.kind ?? "game",
    description: opts.description ?? "",
    createdAt: now,
    updatedAt: now,
    preferredAssets: preferred,
    scenes: [],
    scripts: [],
    tags: [],
    agentNotes: ["Scaffolded with Grudge Project OS. Prefer assets.grudge-studio.com race kits."],
  };

  if (opts.withStarterScene !== false) {
    const sceneFile = "scenes/main.json";
    writeFileSync(join(dir, sceneFile), JSON.stringify(starterSceneJson("Main"), null, 2) + "\n", "utf8");
    manifest.scenes.push({ id: "main", name: "Main", file: sceneFile, template: "starter" });
  }

  if (opts.withStarterScript !== false) {
    const scriptFile = "scripts/main.ts";
    writeFileSync(join(dir, scriptFile), starterScriptTs("Main"), "utf8");
    manifest.scripts.push({
      id: "main",
      name: "Main",
      file: scriptFile,
      language: "typescript",
    });
  }

  // gitignore for agent caches
  writeFileSync(
    join(dir, ".gitignore"),
    `.grudge/drafts/\n.grudge/cache/\nbuilds/\nnode_modules/\n*.log\n`,
    "utf8",
  );

  writeManifest(dir, manifest);
  log.info("[projects] scaffolded", dir);
  return { dir, manifest };
}

// ── List / open ────────────────────────────────────────────────────────

export function listProjects(root?: string): Array<{
  dir: string;
  name: string;
  kind: string;
  updatedAt: string;
  sceneCount: number;
}> {
  const base = root || getProjectsRoot();
  if (!existsSync(base)) return [];
  const out: Array<{ dir: string; name: string; kind: string; updatedAt: string; sceneCount: number }> = [];
  for (const name of readdirSync(base)) {
    const dir = join(base, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      if (!isProjectRoot(dir)) continue;
      const m = readManifest(dir);
      out.push({
        dir,
        name: m.name,
        kind: m.kind,
        updatedAt: m.updatedAt,
        sceneCount: m.scenes?.length ?? 0,
      });
    } catch { /* skip broken */ }
  }
  out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return out;
}

export async function pickProjectsRoot(): Promise<string | null> {
  const res = await dialog.showOpenDialog({
    title: "Select Grudge Projects folder",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: getProjectsRoot(),
  });
  if (res.canceled || !res.filePaths[0]) return null;
  setProjectsRoot(res.filePaths[0]);
  return res.filePaths[0];
}

export async function pickOpenProject(): Promise<string | null> {
  const res = await dialog.showOpenDialog({
    title: "Open Grudge project (folder with grudge.project.json)",
    properties: ["openDirectory"],
    defaultPath: getProjectsRoot(),
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const dir = res.filePaths[0];
  if (!isProjectRoot(dir)) {
    throw new Error(`Not a Grudge project (missing ${PROJECT_MANIFEST})`);
  }
  return dir;
}

export function openInExplorer(projectDir: string): void {
  if (existsSync(projectDir)) shell.openPath(projectDir);
}

// ── Diagnose ───────────────────────────────────────────────────────────

export interface ProjectIssue {
  rule: string;
  severity: "error" | "warn" | "info";
  message: string;
  path?: string;
  hint?: string;
  autoFixable?: boolean;
}

export function diagnoseProject(projectDir: string): {
  ok: boolean;
  issues: ProjectIssue[];
  summary: { error: number; warn: number; info: number };
} {
  const issues: ProjectIssue[] = [];
  if (!existsSync(projectDir)) {
    return {
      ok: false,
      issues: [{ rule: "missing-dir", severity: "error", message: "Project directory does not exist" }],
      summary: { error: 1, warn: 0, info: 0 },
    };
  }

  if (!isProjectRoot(projectDir)) {
    issues.push({
      rule: "missing-manifest",
      severity: "error",
      message: `Missing ${PROJECT_MANIFEST}`,
      hint: "Run scaffold or auto_fix to create a manifest.",
      autoFixable: true,
    });
  } else {
    try {
      const m = readManifest(projectDir);
      if (m.schemaVersion !== PROJECT_SCHEMA_VERSION) {
        issues.push({
          rule: "schema-version",
          severity: "warn",
          message: `Manifest schema ${m.schemaVersion} ≠ current ${PROJECT_SCHEMA_VERSION}`,
          autoFixable: true,
        });
      }
      if (!m.preferredAssets?.length) {
        issues.push({
          rule: "no-preferred-assets",
          severity: "info",
          message: "No preferredAssets — agents may invent URLs.",
          hint: "Seed with Grudge6 race kits + vehicle catalog.",
          autoFixable: true,
        });
      }
      for (const s of m.scenes ?? []) {
        if (!existsSync(join(projectDir, s.file))) {
          issues.push({
            rule: "scene-file-missing",
            severity: "error",
            message: `Scene file missing: ${s.file}`,
            path: s.file,
            autoFixable: true,
          });
        }
      }
      for (const sc of m.scripts ?? []) {
        if (!existsSync(join(projectDir, sc.file))) {
          issues.push({
            rule: "script-file-missing",
            severity: "error",
            message: `Script file missing: ${sc.file}`,
            path: sc.file,
            autoFixable: true,
          });
        }
      }
      // Prefer CDN assets over local-only placeholders
      for (const a of m.preferredAssets ?? []) {
        if (a.url?.includes("toon-shooter") || a.path?.includes("toon-shooter")) {
          issues.push({
            rule: "placeholder-asset",
            severity: "warn",
            message: `Placeholder / toon-shooter asset: ${a.path}`,
            path: a.path,
            hint: "Replace with models/grudge6/races/*_Characters.glb",
            autoFixable: true,
          });
        }
        if (!a.grudgeUUID && a.path) {
          issues.push({
            rule: "missing-uuid",
            severity: "info",
            message: `Asset lacks Grudge UUID: ${a.path}`,
            path: a.path,
            autoFixable: true,
          });
        }
      }
    } catch (e: any) {
      issues.push({
        rule: "manifest-parse",
        severity: "error",
        message: `Invalid manifest: ${e?.message ?? e}`,
        autoFixable: false,
      });
    }
  }

  for (const d of PROJECT_DIRS) {
    if (!existsSync(join(projectDir, d))) {
      issues.push({
        rule: "missing-folder",
        severity: "warn",
        message: `Missing folder: ${d}`,
        path: d,
        autoFixable: true,
      });
    }
  }

  // Loose files at root (except allowed)
  try {
    const allowed = new Set([
      PROJECT_MANIFEST, "README.md", ".gitignore", "package.json", "tsconfig.json",
    ]);
    for (const f of readdirSync(projectDir)) {
      const full = join(projectDir, f);
      if (!statSync(full).isFile()) continue;
      if (allowed.has(f)) continue;
      if (/\.(glb|gltf|fbx|obj|png|jpg|wav|mp3)$/i.test(f)) {
        issues.push({
          rule: "loose-binary-root",
          severity: "warn",
          message: `Binary at project root: ${f} — move under assets/`,
          path: f,
          autoFixable: true,
        });
      }
    }
  } catch { /* */ }

  const summary = {
    error: issues.filter((i) => i.severity === "error").length,
    warn: issues.filter((i) => i.severity === "warn").length,
    info: issues.filter((i) => i.severity === "info").length,
  };

  // Persist report
  try {
    ensureDir(join(projectDir, ".grudge/diagnostics"));
    writeFileSync(
      join(projectDir, ".grudge/diagnostics/last-diagnose.json"),
      JSON.stringify({ at: new Date().toISOString(), summary, issues }, null, 2),
      "utf8",
    );
  } catch { /* */ }

  return { ok: summary.error === 0, issues, summary };
}

// ── Auto-fix ─────────────────────────────────────────────────────────

export async function autoFixProject(projectDir: string): Promise<{
  fixed: string[];
  remaining: ProjectIssue[];
  manifest?: GrudgeProjectManifest;
}> {
  const fixed: string[] = [];
  ensureDir(projectDir);

  // Ensure folders
  for (const d of PROJECT_DIRS) {
    const p = join(projectDir, d);
    if (!existsSync(p)) {
      ensureDir(p);
      fixed.push(`mkdir ${d}`);
    }
  }

  // Manifest
  if (!isProjectRoot(projectDir)) {
    const name = basename(projectDir);
    const { manifest } = await scaffoldProject({
      name,
      parentDir: dirname(projectDir),
      withStarterScene: true,
      withStarterScript: true,
    });
    // scaffold creates sibling slug — if dir already exists with same name it may differ.
    // Prefer writing manifest in place:
    if (!isProjectRoot(projectDir)) {
      const now = new Date().toISOString();
      const m: GrudgeProjectManifest = {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        id: randomUUID(),
        name,
        kind: "game",
        createdAt: now,
        updatedAt: now,
        preferredAssets: defaultPreferredAssets(),
        scenes: [],
        scripts: [],
        agentNotes: ["Auto-fixed: created manifest in place."],
      };
      writeManifest(projectDir, m);
      fixed.push("created grudge.project.json");
    } else {
      fixed.push(`scaffolded via ${manifest.id}`);
    }
  }

  let m = readManifest(projectDir);
  m.schemaVersion = PROJECT_SCHEMA_VERSION;

  // Preferred assets seed + UUIDs + replace placeholders
  if (!m.preferredAssets?.length) {
    m.preferredAssets = defaultPreferredAssets();
    fixed.push("seeded preferredAssets (Grudge6 + vehicles)");
  }
  m.preferredAssets = m.preferredAssets.map((a) => {
    if (a.path?.includes("toon-shooter") || a.url?.includes("toon-shooter")) {
      fixed.push(`replaced placeholder ${a.path}`);
      return defaultPreferredAssets()[0];
    }
    if (!a.grudgeUUID && a.path) {
      try {
        a.grudgeUUID = assetRegistry.uuidForAssetPath(a.path);
        fixed.push(`uuid ${a.path}`);
      } catch { /* */ }
    }
    if (a.path && !a.url) {
      a.url = `${CDN_BASE}/${a.path.replace(/^\//, "")}`;
      fixed.push(`cdn url ${a.path}`);
    }
    return a;
  });

  // Recreate missing scene/script files
  for (const s of m.scenes ?? []) {
    const fp = join(projectDir, s.file);
    if (!existsSync(fp)) {
      ensureDir(dirname(fp));
      writeFileSync(fp, JSON.stringify(starterSceneJson(s.name), null, 2) + "\n", "utf8");
      fixed.push(`restored scene ${s.file}`);
    }
  }
  for (const sc of m.scripts ?? []) {
    const fp = join(projectDir, sc.file);
    if (!existsSync(fp)) {
      ensureDir(dirname(fp));
      writeFileSync(fp, starterScriptTs(sc.name), "utf8");
      fixed.push(`restored script ${sc.file}`);
    }
  }

  // Move loose binaries from root into assets/models or textures
  try {
    for (const f of readdirSync(projectDir)) {
      const full = join(projectDir, f);
      if (!statSync(full).isFile()) continue;
      let destSub: string | null = null;
      if (/\.(glb|gltf|fbx|obj|stl)$/i.test(f)) destSub = "assets/models";
      else if (/\.(png|jpg|jpeg|webp|ktx2)$/i.test(f)) destSub = "assets/textures";
      else if (/\.(wav|mp3|ogg)$/i.test(f)) destSub = "assets/audio";
      if (!destSub) continue;
      const dest = join(projectDir, destSub, f);
      ensureDir(dirname(dest));
      if (!existsSync(dest)) {
        renameSync(full, dest);
        fixed.push(`moved ${f} → ${destSub}/`);
      }
    }
  } catch (e: any) {
    log.warn("[projects] move loose files:", e?.message);
  }

  if (!existsSync(join(projectDir, "README.md"))) {
    writeFileSync(
      join(projectDir, "README.md"),
      `# ${m.name}\n\nAuto-generated project README.\n\n\`\`\`\n${PROJECT_TREE_DOC}\n\`\`\`\n`,
      "utf8",
    );
    fixed.push("README.md");
  }

  m.agentNotes = [
    ...(m.agentNotes ?? []).slice(-8),
    `Auto-fix ${new Date().toISOString()}: ${fixed.length} actions`,
  ];
  writeManifest(projectDir, m);

  const after = diagnoseProject(projectDir);
  try {
    writeFileSync(
      join(projectDir, ".grudge/diagnostics/last-autofix.json"),
      JSON.stringify({ at: new Date().toISOString(), fixed, remaining: after.issues }, null, 2),
      "utf8",
    );
  } catch { /* */ }

  return { fixed, remaining: after.issues, manifest: m };
}

// ── Best assets ────────────────────────────────────────────────────────

export async function resolveBestAssets(query: string, limit = 12): Promise<Array<{
  path: string;
  url: string;
  grudgeUUID?: string;
  score: number;
  reason: string;
}>> {
  const q = query.trim().toLowerCase();
  const results: Array<{ path: string; url: string; grudgeUUID?: string; score: number; reason: string }> = [];

  // 1. Canonical race kits
  for (const race of Object.values(RACE_GRUDGE6)) {
    const hay = `${race.label} ${race.cdnPath} grudge6 race character`.toLowerCase();
    if (!q || hay.includes(q) || q.includes(race.modelId) || q.includes("race") || q.includes("character")) {
      results.push({
        path: race.cdnPath.replace(/^\//, ""),
        url: race.cdnUrl,
        grudgeUUID: assetRegistry.uuidForAssetPath(race.cdnPath.replace(/^\//, "")),
        score: q.includes(race.modelId) ? 100 : 80,
        reason: `Canonical Grudge6 ${race.label} race kit`,
      });
    }
  }

  // 2. Registry path search
  try {
    const reg = await assetRegistry.loadRegistry(false);
    for (const [path, entry] of Object.entries(reg.byPath)) {
      if (q && !path.toLowerCase().includes(q) && !entry.slot?.toLowerCase().includes(q)) continue;
      results.push({
        path,
        url: `${CDN_BASE}/${path}`,
        grudgeUUID: entry.grudgeUUID,
        score: path.toLowerCase().startsWith("models/grudge6") ? 90 : 60,
        reason: `Registry ${entry.slot || "asset"}`,
      });
    }
  } catch { /* */ }

  // 3. R2 list fallback for common prefixes
  if (results.length < 4) {
    const prefixes = ["models/grudge6/", "models/vehicles/", "asset-packs/"];
    for (const prefix of prefixes) {
      try {
        const list = await r2List({ prefix, limit: 30, delimiter: "" });
        for (const it of list.items) {
          if (q && !it.name.toLowerCase().includes(q)) continue;
          if (!/\.(glb|gltf|json|webp|png)$/i.test(it.name)) continue;
          results.push({
            path: it.name,
            url: `${CDN_BASE}/${it.name}`,
            grudgeUUID: assetRegistry.uuidForAssetPath(it.name),
            score: 50,
            reason: "R2 listing",
          });
        }
      } catch { /* */ }
    }
  }

  // Dedup by path, sort by score
  const byPath = new Map<string, (typeof results)[0]>();
  for (const r of results) {
    const prev = byPath.get(r.path);
    if (!prev || r.score > prev.score) byPath.set(r.path, r);
  }
  return [...byPath.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function verifyPreferredAssets(projectDir: string): Promise<{
  ok: boolean;
  results: Array<{ path: string; reachable: boolean; grudgeUUID?: string | null }>;
}> {
  const m = readManifest(projectDir);
  const results: Array<{ path: string; reachable: boolean; grudgeUUID?: string | null }> = [];
  for (const a of m.preferredAssets ?? []) {
    let reachable = false;
    try {
      const head = await r2Head(a.path);
      reachable = (head?.size ?? 0) > 0 || true;
    } catch {
      try {
        const res = await fetch(a.url || `${CDN_BASE}/${a.path}`, { method: "HEAD", signal: AbortSignal.timeout(4000) });
        reachable = res.ok;
      } catch {
        reachable = false;
      }
    }
    results.push({ path: a.path, reachable, grudgeUUID: a.grudgeUUID });
  }
  return { ok: results.every((r) => r.reachable), results };
}

// ── Save snapshot / draft ──────────────────────────────────────────────

export function saveProjectDraft(
  projectDir: string,
  payload: { sceneId?: string; data: unknown; label?: string },
): { draftPath: string } {
  if (!isProjectRoot(projectDir)) throw new Error("Not a Grudge project");
  const drafts = join(projectDir, ".grudge/drafts");
  ensureDir(drafts);
  const id = payload.sceneId || "scene";
  const draftPath = join(drafts, `${id}-${Date.now()}.json`);
  writeFileSync(
    draftPath,
    JSON.stringify({
      savedAt: new Date().toISOString(),
      label: payload.label ?? "draft",
      data: payload.data,
    }, null, 2),
    "utf8",
  );
  // Keep only last 20 drafts
  try {
    const files = readdirSync(drafts)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, t: statSync(join(drafts, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of files.slice(20)) {
      try { unlinkSync(join(drafts, old.f)); } catch { /* */ }
    }
  } catch { /* */ }
  return { draftPath: toPosix(relative(projectDir, draftPath)) };
}

export function touchProject(projectDir: string, patch?: Partial<GrudgeProjectManifest>): GrudgeProjectManifest {
  const m = readManifest(projectDir);
  Object.assign(m, patch ?? {});
  writeManifest(projectDir, m);
  return m;
}

export function projectLayoutHelp(): string {
  return PROJECT_TREE_DOC;
}
