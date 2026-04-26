import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Renderer Vite config. Two HTML entries:
//   - index.html  -> the main multi-page shell
//   - loader.html -> the small always-on-top GrudgeLoader window
// Electron main is compiled separately by tsc.
export default defineConfig({
  plugins: [react()],
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
    port: 5173,
    strictPort: true,
  },
});
