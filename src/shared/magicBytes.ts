/**
 * Magic-byte gates for mesh/texture bytes — shared by main (Node Buffer)
 * and renderer (ArrayBuffer / Uint8Array).
 *
 * Blocks HTML error pages served as "GLB", empty stubs, and non-glTF binary.
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
  | "unknown";

export interface MagicProbe {
  kind: MagicKind;
  okForMesh: boolean;
  okForTexture: boolean;
  detail: string;
  bytes: number;
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

export function probeMagic(input: ArrayBuffer | Uint8Array): MagicProbe {
  const b = u8(input);
  const n = b.length;
  if (n < 4) {
    return {
      kind: "unknown",
      okForMesh: false,
      okForTexture: false,
      detail: `too small (${n} bytes)`,
      bytes: n,
    };
  }

  // glTF binary: "glTF"
  if (b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46) {
    return {
      kind: "glb",
      okForMesh: n >= 100,
      okForTexture: false,
      detail: n >= 100 ? "GLB magic glTF" : "GLB magic but truncated",
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

  const head = ascii(b, 0, Math.min(64, n));
  if (/<!DOCTYPE|<html|<HTML/i.test(head)) {
    return {
      kind: "html",
      okForMesh: false,
      okForTexture: false,
      detail: "HTML content (CDN/auth error page, not a mesh)",
      bytes: n,
    };
  }

  // glTF JSON
  if (head.trimStart().startsWith("{") && /"asset"\s*:/.test(head + ascii(b, 64, 256))) {
    return {
      kind: "gltf-json",
      okForMesh: true,
      okForTexture: false,
      detail: "glTF JSON",
      bytes: n,
    };
  }

  // FBX binary starts with "Kaydara FBX Binary"
  if (head.startsWith("Kaydara FBX Binary") || head.includes("FBX")) {
    return { kind: "fbx", okForMesh: true, okForTexture: false, detail: "FBX", bytes: n };
  }

  return {
    kind: "unknown",
    okForMesh: false,
    okForTexture: false,
    detail: `unknown magic [${b[0].toString(16)} ${b[1].toString(16)} ${b[2].toString(16)} ${b[3].toString(16)}]`,
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
