/**
 * Pure-JS GLB binary container decoder (no dependencies).
 *
 * GLB layout (https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/README.md#glb-file-format-specification):
 *   header           12 bytes: magic ("glTF"=0x46546C67), version (u32), totalLen (u32)
 *   JSON chunk       length (u32) + type (0x4E4F534A "JSON") + JSON bytes
 *   BIN chunk (opt)  length (u32) + type (0x004E4942 "BIN\0") + binary blob
 */

export interface GlbInspection {
  ok: boolean;
  error?: string;
  magic: string;
  version: number;
  totalLength: number;
  jsonLength: number;
  binLength: number;
  meshes: number;
  materials: number;
  textures: number;
  animations: number;
  skins: number;
  nodes: number;
  scenes: number;
  hasDraco: boolean;
  hasMeshopt: boolean;
  hasKhrTextureBasisu: boolean;
  generator: string | null;
  extensionsUsed: string[];
  extensionsRequired: string[];
  /** Raw decoded JSON chunk for downstream tooling. */
  json: any | null;
}

const FOURCC_GLTF = 0x46546c67;     // "glTF"
const FOURCC_JSON = 0x4e4f534a;     // "JSON"
const FOURCC_BIN  = 0x004e4942;     // "BIN\0"

function fourccToString(fourcc: number): string {
  return String.fromCharCode(
    fourcc & 0xff,
    (fourcc >>> 8) & 0xff,
    (fourcc >>> 16) & 0xff,
    (fourcc >>> 24) & 0xff,
  );
}

export function inspectGlb(buf: ArrayBuffer): GlbInspection {
  const empty: GlbInspection = {
    ok: false,
    magic: "",
    version: 0,
    totalLength: buf.byteLength,
    jsonLength: 0,
    binLength: 0,
    meshes: 0,
    materials: 0,
    textures: 0,
    animations: 0,
    skins: 0,
    nodes: 0,
    scenes: 0,
    hasDraco: false,
    hasMeshopt: false,
    hasKhrTextureBasisu: false,
    generator: null,
    extensionsUsed: [],
    extensionsRequired: [],
    json: null,
  };
  if (buf.byteLength < 12) return { ...empty, error: "buffer too small for GLB header" };
  const dv = new DataView(buf);
  const magic = dv.getUint32(0, true);
  const version = dv.getUint32(4, true);
  const total = dv.getUint32(8, true);
  if (magic !== FOURCC_GLTF) return { ...empty, error: `not a GLB (magic=${fourccToString(magic)})` };
  let offset = 12;
  let jsonLen = 0;
  let jsonStr = "";
  let binLen = 0;
  while (offset < buf.byteLength) {
    const chunkLen = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const data = buf.slice(offset + 8, offset + 8 + chunkLen);
    if (chunkType === FOURCC_JSON) {
      jsonLen = chunkLen;
      jsonStr = new TextDecoder("utf-8").decode(data);
    } else if (chunkType === FOURCC_BIN) {
      binLen = chunkLen;
    }
    offset += 8 + chunkLen;
  }
  let json: any = null;
  try {
    json = jsonStr ? JSON.parse(jsonStr) : null;
  } catch {
    /* malformed JSON — leave null */
  }
  const ext: string[] = Array.isArray(json?.extensionsUsed) ? json.extensionsUsed : [];
  const extReq: string[] = Array.isArray(json?.extensionsRequired) ? json.extensionsRequired : [];
  return {
    ok: true,
    magic: fourccToString(magic),
    version,
    totalLength: total,
    jsonLength: jsonLen,
    binLength: binLen,
    meshes: json?.meshes?.length ?? 0,
    materials: json?.materials?.length ?? 0,
    textures: json?.textures?.length ?? 0,
    animations: json?.animations?.length ?? 0,
    skins: json?.skins?.length ?? 0,
    nodes: json?.nodes?.length ?? 0,
    scenes: json?.scenes?.length ?? 0,
    hasDraco: ext.includes("KHR_draco_mesh_compression") || extReq.includes("KHR_draco_mesh_compression"),
    hasMeshopt: ext.includes("EXT_meshopt_compression") || extReq.includes("EXT_meshopt_compression"),
    hasKhrTextureBasisu: ext.includes("KHR_texture_basisu") || extReq.includes("KHR_texture_basisu"),
    generator: json?.asset?.generator ?? null,
    extensionsUsed: ext,
    extensionsRequired: extReq,
    json,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
