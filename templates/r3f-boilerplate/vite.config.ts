import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: true, target: "esnext" },
  server: { port: 5174, strictPort: false },
  worker: { format: "es" },
});
