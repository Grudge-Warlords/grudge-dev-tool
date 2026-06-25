/** Minimal Grudge UUID generator for asset-pack ingestion */

const SLOT_BY_EXT: Record<string, string> = {
  ".png": "Texture",
  ".jpg": "Texture",
  ".jpeg": "Texture",
  ".webp": "Texture",
  ".gif": "Texture",
  ".glb": "BlendModel",
  ".gltf": "BlendModel",
  ".fbx": "BlendModel",
  ".obj": "Mesh",
  ".wav": "Audio",
  ".mp3": "Audio",
  ".ogg": "Audio",
};

const SLOT_CODES: Record<string, string> = {
  Texture: "texr",
  BlendModel: "mdlb",
  Mesh: "mesh",
  Sprite: "sprt",
  Audio: "audi",
  Item: "item",
  Unknown: "unkn",
};

let counter = 1;

function slotCode(slot: string): string {
  return SLOT_CODES[slot] || slot.slice(0, 4).padEnd(4, "x");
}

function texasTimestamp(): string {
  const t = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }),
  );
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getMonth() + 1)}${pad(t.getDate())}${t.getFullYear()}`;
}

function nextCounter(): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let n = counter++;
  let out = "";
  do {
    out = chars[n % 36] + out;
    n = Math.floor(n / 36);
  } while (n > 0);
  return out.padStart(6, "0");
}

export function slotForFile(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return SLOT_BY_EXT[ext] || "Item";
}

export function generateAssetUUID(slot: string, itemId: number): string {
  return `${slotCode(slot)}-oo-${String(itemId).padStart(4, "0")}-${texasTimestamp()}-${nextCounter()}`;
}