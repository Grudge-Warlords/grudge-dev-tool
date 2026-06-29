/**
 * Content-Security-Policy for renderer HTML shells (index.html, loader.html).
 * Keep both meta tags in sync with this string — or run `npm run build` which
 * injects it via the Vite `grudge-csp` plugin.
 */
export const RENDERER_CSP = [
  "default-src 'self'",
  [
    "img-src 'self' data: blob: file:",
    "https://assets.grudge-studio.com",
    "https://*.grudge-studio.com",
    "https://*.puter.site",
    "https://*.puter.com",
    "https://*.r2.dev",
    "https://*.r2.cloudflarestorage.com",
    "https://opengraph.githubassets.com",
    "https://*.githubusercontent.com",
    "https://www.blenderkit.com",
    "https://*.blenderkit.com",
  ].join(" "),
  "media-src 'self' data: blob:",
  [
    "connect-src 'self' blob: data: file:",
    "http://localhost:*",
    "http://127.0.0.1:*",
    "https://api.grudge-studio.com",
    "https://*.grudge-studio.com",
    "https://assets.grudge-studio.com",
    "https://js.puter.com",
    "https://api.puter.com",
    "https://*.puter.com",
    "wss://*.puter.com",
    "https://*.r2.cloudflarestorage.com",
    "https://*.r2.dev",
  ].join(" "),
  "style-src 'self' 'unsafe-inline'",
  [
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "https://js.puter.com",
    "https://*.puter.com",
  ].join(" "),
  "worker-src 'self' blob:",
  "frame-src 'self' http://localhost:* http://127.0.0.1:* https://*.puter.com https://*.puter.site https://*.grudge-studio.com",
  "child-src 'self' blob: http://localhost:* http://127.0.0.1:* https://*.puter.com https://*.puter.site https://*.grudge-studio.com",
].join("; ") + ";";

/** Loader window omits Forge/Three.js-only directives (no workers / unsafe-eval). */
export const LOADER_CSP = [
  "default-src 'self'",
  [
    "img-src 'self' data: blob: file:",
    "https://assets.grudge-studio.com",
    "https://*.grudge-studio.com",
    "https://*.puter.site",
    "https://*.puter.com",
    "https://*.r2.dev",
    "https://*.r2.cloudflarestorage.com",
    "https://opengraph.githubassets.com",
    "https://*.githubusercontent.com",
    "https://www.blenderkit.com",
    "https://*.blenderkit.com",
  ].join(" "),
  [
    "connect-src 'self' file:",
    "http://127.0.0.1:*",
    "https://api.grudge-studio.com",
    "https://*.grudge-studio.com",
    "https://assets.grudge-studio.com",
    "https://js.puter.com",
    "https://api.puter.com",
    "https://*.puter.com",
    "wss://*.puter.com",
    "https://*.r2.cloudflarestorage.com",
    "https://*.r2.dev",
  ].join(" "),
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://js.puter.com https://*.puter.com",
  "frame-src 'self' http://localhost:* http://127.0.0.1:* https://*.puter.com https://*.puter.site https://*.grudge-studio.com",
  "child-src 'self' http://localhost:* http://127.0.0.1:* https://*.puter.com https://*.puter.site https://*.grudge-studio.com",
].join("; ") + ";";