/**
 * Magic-byte gates for mesh/texture bytes — shared by main (Node Buffer)
 * and renderer (ArrayBuffer / Uint8Array).
 *
 * Blocks HTML error pages served as "GLB", empty stubs, JSON API errors,
 * and non-glTF binary. Recognizes multi-file glTF JSON (scene.gltf) that
 * starts with `{\n  ` (bytes 7b 0a 20 20) when "asset" appears later in file.
 */

export type MagicKind =
  | "glb"
  | "gltf-json"
  | "png"
  | "jpeg"
  | "webp"
  | "gif"
  | "fbx"
  | "html"
  | "json-stub"
  | "unknown";

export interface MagicProbe {
  kind: MagicKind;
  okForMesh: boolean;
  okForTexture: boolean;
  detail: string;
  bytes: number;
}

/** THREE.FBXLoader: ASCII ≥ 7000, binary ≥ 6400. FileVersion 6100 is FBX 6.1 (unsupported). */
export const THREE_FBX_MIN_ASCII = 7000;
export const THREE_FBX_MIN_BINARY = 6400;

export interface FbxVersionProbe {
  format: "binary" | "ascii" | "unknown";
  version: number | null;
  threeSupported: boolean;
  detail: string;
}

/**
 * Read FBX FileVersion from binary header or ASCII `FBXVersion: 6100`.
 * Binary: "Kaydara FBX Binary  \\0" + 0x1A 0x00 + uint32 LE at offset 23.
 */
export function parseFbxVersion(input: ArrayBuffer | Uint8Array): FbxVersionProbe {
  const b = u8(input);
  const n = b.length;
  if (n < 27) {
    return { format: "unknown", version: null, threeSupported: false, detail: "FBX too small to read version" };
  }
  const head = ascii(b, 0, Math.min(n, 96));
  if (head.startsWith("Kaydara FBX Binary")) {
    const version = b[23] | (b[24] << 8) | (b[25] << 16) | (b[26] << 24);
    const threeSupported = version >= THREE_FBX_MIN_BINARY;
    return {
      format: "binary",
      version,
      threeSupported,
      detail: `FBX binary FileVersion ${version}${threeSupported ? "" : " — THREE needs ≥6400; convert via Blender"}`,
    };
  }
  const sample = ascii(b, 0, Math.min(n, 64 * 1024));
  const m = sample.match(/FBXVersion:\s*(\d+)/i) || sample.match(/FileVersion:\s*(\d+)/i);
  if (m) {
    const version = Number(m[1]);
    const threeSupported = version >= THREE_FBX_MIN_ASCII;
    return {
      format: "ascii",
      version,
      threeSupported,
      detail: `FBX ascii FileVersion ${version}${threeSupported ? "" : " — THREE needs ≥7000; convert via Blender (6.1/6100)"}`,
    };
  }
  if (/^; FBX/i.test(sample.trimStart().slice(0, 32))) {
    return {
      format: "ascii",
      version: null,
      threeSupported: false,
      detail: "FBX ascii, version not found — convert via Blender",
    };
  }
  return { format: "unknown", version: null, threeSupported: false, detail: "not an FBX header" };
}

function u8(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  const end = Math.min(bytes.length, start + len);
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function hexMagic(b: Uint8Array): string {
  const n = Math.min(4, b.length);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(b[i].toString(16));
  return parts.join(" ");
}

/** Strip UTF-8 BOM and leading whitespace for text probes. */
function trimTextStart(s: string): string {
  return s.replace(/^\uFEFF/, "").trimStart();
}

/**
 * Probe first bytes (and up to 64 KiB of text) to classify mesh/texture content.
 * Prefer full file or ≥4 KiB head for .gltf JSON — "asset" may sit after extensions.
 */
export function probeMagic(input: ArrayBuffer | Uint8Array): MagicProbe {
  const b = u8(input);
  const n = b.length;

  if (n === 0) {
    return {
      kind: "unknown",
      okForMesh: false,
      okForTexture: false,
      detail: "empty stub (0 bytes)",
      bytes: 0,
    };
  }
  if (n < 4) {
    return {
      kind: "unknown",
      okForMesh: false,
      okForTexture: false,
      detail: `too small (${n} bytes)`,
      bytes: n,
    };
  }

  // glTF binary: "glTF" (0x67 0x6c 0x54 0x46)
  if (b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46) {
    return {
      kind: "glb",
      okForMesh: n >= 20,
      okForTexture: false,
      detail: n >= 20 ? "GLB magic glTF" : "GLB magic but truncated",
      bytes: n,
    };
  }

  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { kind: "png", okForMesh: false, okForTexture: true, detail: "PNG", bytes: n };
  }
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { kind: "jpeg", okForMesh: false, okForTexture: true, detail: "JPEG", bytes: n };
  }
  // WebP: RIFF....WEBP
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    n >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { kind: "webp", okForMesh: false, okForTexture: true, detail: "WebP", bytes: n };
  }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { kind: "gif", okForMesh: false, okForTexture: true, detail: "GIF", bytes: n };
  }

  // Text sample for HTML / glTF JSON / error stubs (scene.gltf often starts `{\n  `)
  const sampleLen = Math.min(n, 64 * 1024);
  const sample = ascii(b, 0, sampleLen);
  const head = sample.slice(0, 96);
  const trimmed = trimTextStart(sample);

  // HTML / XML error pages (CDN 404, Cloudflare, auth walls)
  if (
    /^(?:<!DOCTYPE\s+html|<html\b|<\?xml)/i.test(trimmed.slice(0, 64)) ||
    /<!DOCTYPE\s+html|<html[\s>]/i.test(head) ||
    (/<body[\s>]/i.test(sample.slice(0, 2000)) &&
      /(?:Error\s+\d{3}|Access Denied|Cloudflare|Just a moment|nginx|Bad Gateway)/i.test(
        sample.slice(0, 4000),
      ))
  ) {
    return {
      kind: "html",
      okForMesh: false,
      okForTexture: false,
      detail: "HTML content (CDN/auth error page, not a mesh)",
      bytes: n,
    };
  }

  // FBX binary starts with "Kaydara FBX Binary"
  if (head.startsWith("Kaydara FBX Binary") || trimmed.startsWith("Kaydara FBX Binary")) {
    const fv = parseFbxVersion(b);
    return {
      kind: "fbx",
      okForMesh: true,
      okForTexture: false,
      detail: fv.detail,
      bytes: n,
    };
  }
  // ASCII FBX
  if (/^; FBX/i.test(trimmed.slice(0, 32)) || /^FBX/i.test(trimmed.slice(0, 8))) {
    const fv = parseFbxVersion(b);
    return {
      kind: "fbx",
      okForMesh: true,
      okForTexture: false,
      detail: fv.detail,
      bytes: n,
    };
  }

  // JSON-like (includes glTF, API errors, empty stubs)
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    // Empty / near-empty stubs
    if (n < 24 || /^\{\s*\}$/.test(trimmed.slice(0, 48)) || /^\[\s*\]$/.test(trimmed.slice(0, 48))) {
      return {
        kind: "json-stub",
        okForMesh: false,
        okForTexture: false,
        detail: "empty JSON stub",
        bytes: n,
      };
    }

    const hasAssetObj = /"asset"\s*:\s*\{/.test(sample);
    const hasVersion = /"version"\s*:\s*"[0-9.]+"/.test(sample);
    const hasMeshes = /"meshes"\s*:\s*\[/.test(sample);
    const hasNodes = /"nodes"\s*:\s*\[/.test(sample);
    const hasScenes = /"scenes"\s*:\s*\[/.test(sample);
    const hasBuffers = /"buffers"\s*:\s*\[/.test(sample);
    const hasAccessors = /"accessors"\s*:\s*\[/.test(sample);
    const hasMaterials = /"materials"\s*:\s*\[/.test(sample);
    const gltfish =
      hasAssetObj ||
      (hasMeshes && hasNodes) ||
      (hasScenes && hasNodes) ||
      (hasBuffers && hasAccessors) ||
      (hasMaterials && hasAccessors);

    // API / CDN JSON errors without glTF structure
    const looksError =
      /"error"\s*:/.test(sample) ||
      /"success"\s*:\s*false/.test(sample) ||
      /"statusCode"\s*:\s*\d+/.test(sample) ||
      /"message"\s*:\s*"(?:Not Found|Unauthorized|Forbidden|Internal)/i.test(sample);
    if (looksError && !gltfish) {
      return {
        kind: "json-stub",
        okForMesh: false,
        okForTexture: false,
        detail: "JSON error/stub (not glTF). Reject HTML/error pages and empty stubs.",
        bytes: n,
      };
    }

    // Valid glTF JSON — scan full sample so `{\n  "extensionsUsed"... "asset"` still matches
    if (hasAssetObj && (hasVersion || hasMeshes || hasNodes || hasScenes || hasBuffers || hasAccessors)) {
      return {
        kind: "gltf-json",
        okForMesh: true,
        okForTexture: false,
        detail: "glTF JSON",
        bytes: n,
      };
    }
    // Structure-only (rare exporters / truncated head still has meshes+nodes)
    if ((hasMeshes && hasNodes) || (hasScenes && hasNodes && (hasAccessors || hasBuffers))) {
      return {
        kind: "gltf-json",
        okForMesh: true,
        okForTexture: false,
        detail: "glTF JSON (structure match)",
        bytes: n,
      };
    }

    // Starts with `{` but is not glTF — classic false path that used to show
    // "unknown magic [7b a 20 20]" for scene.gltf error pages AND valid files
    // when "asset" was beyond the old 320-byte window.
    return {
      kind: "json-stub",
      okForMesh: false,
      okForTexture: false,
      detail:
        `JSON but not glTF (no asset/meshes; magic [${hexMagic(b)}]). ` +
        `Reject HTML/error pages and empty stubs.`,
      bytes: n,
    };
  }

  return {
    kind: "unknown",
    okForMesh: false,
    okForTexture: false,
    detail: `unknown magic [${hexMagic(b)}]. Reject HTML/error pages and empty stubs.`,
    bytes: n,
  };
}

/** Throw if buffer is not a real GLB/glTF mesh. */
export function assertMeshBytes(
  input: ArrayBuffer | Uint8Array,
  label = "asset",
): MagicProbe {
  const p = probeMagic(input);
  if (!p.okForMesh) {
    throw new Error(
      `${label}: not a valid mesh (${p.detail}). Reject HTML/error pages and empty stubs.`,
    );
  }
  return p;
}

/** True when Content-Type looks like an HTML error page (CDN fake 200). */
export function isHtmlContentType(ct: string | null | undefined): boolean {
  if (!ct) return false;
  const c = ct.toLowerCase();
  return c.includes("text/html") || c.includes("application/xhtml");
}

/**
 * Gate a fetch Response before treating body as mesh.
 * Rejects HTML content-types even when status is 200.
 */
export function assertMeshResponseHeaders(
  res: { ok: boolean; status: number; headers: { get(name: string): string | null } },
  label = "asset",
): void {
  if (!res.ok) {
    throw new Error(`${label}: HTTP ${res.status} — not a mesh`);
  }
  const ct = res.headers.get("content-type");
  if (isHtmlContentType(ct)) {
    throw new Error(
      `${label}: Content-Type ${ct} is HTML (error page), not a mesh. Reject HTML/error pages and empty stubs.`,
    );
  }
}
