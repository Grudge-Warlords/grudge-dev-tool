import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as {
  version: string;
};

// Renderer Vite config. HTML entries:
//   - index.html  -> the main multi-page shell
//   - loader.html -> the small always-on-top GrudgeLoader window
//   - viewer.html -> pop-out Three.js asset viewer
// Electron main is compiled separately by tsc.
//
// envDir = package root so VITE_ADMIN_* from .env bake into production builds
// (admin gate for grudachain / molochdadev). Canonical allowlist is also
// hardcoded in src/shared/adminAllowlist.ts as fallback.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname), "");
  // Ensure production builds always bake operator usernames even if .env is thin.
  const adminUsers =
    env.VITE_ADMIN_USERNAMES?.trim() ||
    "grudachain,molochdadev";
  const adminEmails =
    env.VITE_ADMIN_EMAILS?.trim() ||
    "grudgedev@gmail.com,jonbemmons@gmail.com";

  return {
    plugins: [react()],
    root: resolve(__dirname, "src/renderer"),
    envDir: resolve(__dirname),
    base: "./",
    define: {
      // Force-inline when unset so packaged NSIS is never open-mode by accident
      "import.meta.env.VITE_ADMIN_USERNAMES": JSON.stringify(adminUsers),
      "import.meta.env.VITE_ADMIN_EMAILS": JSON.stringify(adminEmails),
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      outDir: resolve(__dirname, "dist/renderer"),
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, "src/renderer/index.html"),
          loader: resolve(__dirname, "src/renderer/loader.html"),
          viewer: resolve(__dirname, "src/renderer/viewer.html"),
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
