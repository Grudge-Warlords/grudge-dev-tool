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
    id: "arpg-game",
    name: "ARPG Game · Danger Room",
    rootDir: "C:\\Users\\nugye\\Documents\\Character-Animator-two\\Character-Animator-two\\artifacts\\arpg-game",
    description: "Third-person shooter lab — Racalvin, Heavy, course modes",
    devCommand: "pnpm dev",
    buildCommand: "pnpm build",
    previewCommand: "pnpm serve",
    defaultPort: 5173,
    distIndex: "dist/public/index.html",
    remoteDevUrl: "https://grudge-character-creator.vercel.app",
    packageManager: "pnpm",
  },
  {
    id: "character-animator",
    name: "Character Animator (monorepo)",
    rootDir: "C:\\Users\\nugye\\Documents\\Character-Animator-two\\Character-Animator-two",
    description: "grudge-game /world, character-viewer, character-kit",
    devCommand: "pnpm --filter @workspace/grudge-game run dev",
    buildCommand: "pnpm --filter @workspace/grudge-game run build",
    previewCommand: "pnpm --filter @workspace/grudge-game run serve",
    defaultPort: 5173,
    distIndex: "artifacts/grudge-game/dist/public/index.html",
    remoteDevUrl: "https://grudge-character-creator.vercel.app/game/world",
    packageManager: "pnpm",
  },
  {
    id: "grudge-builder",
    name: "GrudgeBuilder",
    rootDir: "F:\\GitHub\\GrudgeBuilder",
    description: "Island engine, auth, Railway backend",
    devCommand: "pnpm dev",
    buildCommand: "pnpm build",
    defaultPort: 3000,
    remoteDevUrl: "https://client.grudge-studio.com",
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