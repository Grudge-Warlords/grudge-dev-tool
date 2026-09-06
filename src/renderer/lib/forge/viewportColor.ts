/**
 * Elite / Forge / Play viewport colours.
 * Sand #EFD1B5 was a 1.0.10 black-canvas workaround — it tints PBR yellow.
 * Default is Grudge studio navy (matches app chrome + Model3DViewer).
 */
export type EditorViewportId = "studio" | "charcoal" | "neutral" | "sand" | "white";

export type EditorViewport = {
  id: EditorViewportId;
  label: string;
  bg: number;
  hex: string;
  gridCell: number;
  gridSection: number;
  ground: number;
};

export const EDITOR_VIEWPORTS: Record<EditorViewportId, EditorViewport> = {
  studio: {
    id: "studio",
    label: "Studio",
    bg: 0x0a0e1a,
    hex: "#0a0e1a",
    gridCell: 0x1c2a55,
    gridSection: 0xffc62a,
    ground: 0x12161f,
  },
  charcoal: {
    id: "charcoal",
    label: "Charcoal",
    bg: 0x111418,
    hex: "#111418",
    gridCell: 0x2a3344,
    gridSection: 0xc9a227,
    ground: 0x161a20,
  },
  neutral: {
    id: "neutral",
    label: "Neutral",
    bg: 0x4a4e58,
    hex: "#4a4e58",
    gridCell: 0x6a7080,
    gridSection: 0xe8d48b,
    ground: 0x3e424c,
  },
  sand: {
    id: "sand",
    label: "Sand",
    bg: 0xefd1b5,
    hex: "#efd1b5",
    gridCell: 0x7a5a38,
    gridSection: 0x3d2818,
    ground: 0xc9b089,
  },
  white: {
    id: "white",
    label: "White",
    bg: 0xf4f4f6,
    hex: "#f4f4f6",
    gridCell: 0xd0d4dc,
    gridSection: 0x888c96,
    ground: 0xe8e8ec,
  },
};

export const DEFAULT_EDITOR_VIEWPORT = EDITOR_VIEWPORTS.studio;

export const EDITOR_VIEWPORT_LIST = Object.values(EDITOR_VIEWPORTS);

export function viewportFromHex(hex: string | number): EditorViewport | undefined {
  const n = typeof hex === "number" ? hex : parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return undefined;
  return EDITOR_VIEWPORT_LIST.find((v) => v.bg === n);
}
