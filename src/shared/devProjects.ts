/** Grudge Studio local dev / preview project registry (shared main + renderer). */

export type DevServerMode = "dev" | "preview" | "static";

export interface DevProject {
  id: string;
  name: string;
  rootDir: string;
  description?: string;
  /** Shell command for hot-reload dev server (default: pnpm dev). */
  devCommand?: string;
  /** Production build (default: pnpm build). */
  buildCommand?: string;
  /** Post-build static server (default: pnpm serve / vite preview). */
  previewCommand?: string;
  /** Hint when stdout parsing fails. */
  defaultPort?: number;
  /** Relative path to built index.html inside rootDir. */
  distIndex?: string;
  /** Hosted dev/staging URL (Vercel, CF Pages, etc.). */
  remoteDevUrl?: string;
  packageManager?: "pnpm" | "npm" | "yarn";
}

export const DEV_PROJECT_PRESETS: DevProject[] = [
  {
    id: "grudge-builder",
    name: "GrudgeBuilder (client play)",
    rootDir: "F:\\GitHub\\GrudgeBuilder",
    description: "Island engine, auth, Railway — client.grudge-studio.com",
    devCommand: "pnpm dev",
    buildCommand: "pnpm build",
    defaultPort: 3000,
    remoteDevUrl: "https://client.grudge-studio.com",
    packageManager: "pnpm",
  },
  {
    id: "gameopen",
    name: "Open Launcher",
    rootDir: "C:\\Users\\nugye\\Documents\\gameopen",
    description: "Steam-style library · open.grudge-studio.com",
    devCommand: "npm run dev",
    buildCommand: "npm run build",
    defaultPort: 5173,
    remoteDevUrl: "https://open.grudge-studio.com",
    packageManager: "npm",
  },
  {
    id: "multiverse",
    name: "Grudge Multiverse",
    rootDir: "F:\\GitHub\\grudge-multiverse",
    description:
      "Bermuda MP island · grudge-multiverse.vercel.app + Railway /api/mv",
    devCommand: "npm run dev",
    buildCommand: "npm run build",
    defaultPort: 5173,
    remoteDevUrl: "https://grudge-multiverse.vercel.app/#room1",
    packageManager: "npm",
  },
  {
    id: "tactical-infinity",
    name: "Water / Home Island",
    rootDir: "F:\\GitHub\\Tactical-Infinity",
    description: "Warlords water island — water.grudge-studio.com only",
    devCommand: "npm run dev",
    buildCommand: "npm run build",
    defaultPort: 5173,
    remoteDevUrl: "https://water.grudge-studio.com",
    packageManager: "npm",
  },
  {
    id: "character-animator",
    name: "Character Foundry monorepo",
    rootDir: "F:\\GitHub\\grudge-character-animator",
    description: "character.grudge-studio.com create + 4-slot",
    devCommand: "pnpm dev",
    buildCommand: "pnpm build",
    defaultPort: 5173,
    remoteDevUrl: "https://character.grudge-studio.com",
    packageManager: "pnpm",
  },
  {
    id: "rts-grudge",
    name: "RTS-Grudge / Forge",
    rootDir: "F:\\GitHub\\RTS-Grudge",
    description: "Forge map editor + RTS — forge.grudge-studio.com",
    devCommand: "pnpm dev",
    buildCommand: "pnpm build",
    defaultPort: 5173,
    remoteDevUrl: "https://forge.grudge-studio.com",
    packageManager: "pnpm",
  },
  {
    id: "arpg-game",
    name: "ARPG Game · Danger Room",
    rootDir: "C:\\Users\\nugye\\Documents\\Character-Animator-two\\Character-Animator-two\\artifacts\\arpg-game",
    description: "Third-person shooter lab — Racalvin, Heavy, course modes",
    devCommand: "pnpm dev",
    buildCommand: "pnpm build",
    previewCommand: "pnpm serve",
    defaultPort: 5173,
    distIndex: "dist/public/index.html",
    remoteDevUrl: "https://character.grudge-studio.com",
    packageManager: "pnpm",
  },
  {
    id: "grudge-dev-tool",
    name: "Grudge Dev Tool",
    rootDir: "F:\\GitHub\\grudge-dev-tool",
    description: "This Electron app (renderer vite on 5173)",
    devCommand: "npm run dev",
    buildCommand: "npm run build",
    defaultPort: 5173,
    packageManager: "npm",
  },
];

export function mergeDevProjects(
  manifestProjects: Array<Partial<DevProject> & { id: string; name: string; rootDir: string }>,
): DevProject[] {
  const byId = new Map<string, DevProject>();
  for (const preset of DEV_PROJECT_PRESETS) byId.set(preset.id, { ...preset });
  for (const entry of manifestProjects) {
    const prev = byId.get(entry.id);
    byId.set(entry.id, {
      ...(prev ?? {}),
      id: entry.id,
      name: entry.name,
      rootDir: entry.rootDir,
      description: entry.description ?? prev?.description,
      devCommand: entry.devCommand ?? prev?.devCommand ?? "pnpm dev",
      buildCommand: entry.buildCommand ?? prev?.buildCommand ?? "pnpm build",
      previewCommand: entry.previewCommand ?? prev?.previewCommand,
      defaultPort: entry.defaultPort ?? prev?.defaultPort ?? 5173,
      distIndex: entry.distIndex ?? prev?.distIndex,
      remoteDevUrl: entry.remoteDevUrl ?? prev?.remoteDevUrl,
      packageManager: entry.packageManager ?? prev?.packageManager ?? "pnpm",
    } as DevProject);
  }
  return [...byId.values()].filter((p) => p.rootDir?.trim());
}