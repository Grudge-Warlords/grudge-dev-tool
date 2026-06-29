import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { LOADER_CSP, RENDERER_CSP } from "./src/shared/rendererCsp";

function grudgeCspPlugin(): Plugin {
  return {
    name: "grudge-csp",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const csp = ctx.filename?.includes("loader.html") ? LOADER_CSP : RENDERER_CSP;
        return html.replace("__GRUDGE_CSP__", csp);
      },
    },
  };
}

// Renderer Vite config. Two HTML entries:
//   - index.html  -> the main multi-page shell
//   - loader.html -> the small always-on-top GrudgeLoader window
// Electron main is compiled separately by tsc.
export default defineConfig({
  plugins: [grudgeCspPlugin(), react()],
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/renderer/index.html"),
        loader: resolve(__dirname, "src/renderer/loader.html"),
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    strictPort: true,
  },
});
