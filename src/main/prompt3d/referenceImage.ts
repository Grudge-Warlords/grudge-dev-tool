import { createHash } from "node:crypto";
import { lstat, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import sharp from "sharp";
import type {
  Prompt3DReferenceImageMediaType,
  Prompt3DReferenceImageSelection,
  Prompt3DReferenceImageSpec,
  Prompt3DReferenceImageView,
  Prompt3DRetainedReferenceImage,
} from "../../shared/prompt3d";

export const PROMPT3D_REFERENCE_MAX_BYTES = 20 * 1024 ** 2;
export const PROMPT3D_REFERENCE_MAX_PIXELS = 32 * 1024 ** 2;
export const PROMPT3D_REFERENCE_MAX_EDGE = 8_192;
export const PROMPT3D_REFERENCE_MIN_EDGE = 64;
export const PROMPT3D_REFERENCE_MAX_COUNT = 4;
export const PROMPT3D_REFERENCE_MAX_TOTAL_BYTES = PROMPT3D_REFERENCE_MAX_COUNT * PROMPT3D_REFERENCE_MAX_BYTES;

const SHA256 = /^[a-f0-9]{64}$/;
const REFERENCE_VIEWS: Prompt3DReferenceImageView[] = ["front", "left", "back", "right"];
const MEDIA_EXTENSION: Record<Prompt3DReferenceImageMediaType, "png" | "jpg" | "webp"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

type ValidatedReference = {
  bytes: Buffer;
  identity: Prompt3DReferenceImageSpec;
};

function contained(root: string, target: string): string {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const rel = relative(rootPath, targetPath);
  if (rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))) return targetPath;
  throw new Error("Retained reference image escapes its task-owned job directory.");
}

function mediaTypeFor(format: string | undefined): Prompt3DReferenceImageMediaType {
  if (format === "png") return "image/png";
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  throw new Error("Reference image must be a genuine PNG, JPEG or WebP file.");
}

export function assertPrompt3DReferenceImageSpec(value: unknown): asserts value is Prompt3DReferenceImageSpec {
  if (!value || typeof value !== "object") throw new Error("Reference-image identity is invalid.");
  const item = value as Prompt3DReferenceImageSpec;
  if (item.version !== 1 || !SHA256.test(item.sha256)
    || !["image/png", "image/jpeg", "image/webp"].includes(item.mediaType)
    || !Number.isSafeInteger(item.byteSize) || item.byteSize < 1 || item.byteSize > PROMPT3D_REFERENCE_MAX_BYTES
    || !Number.isSafeInteger(item.width) || item.width < PROMPT3D_REFERENCE_MIN_EDGE || item.width > PROMPT3D_REFERENCE_MAX_EDGE
    || !Number.isSafeInteger(item.height) || item.height < PROMPT3D_REFERENCE_MIN_EDGE || item.height > PROMPT3D_REFERENCE_MAX_EDGE
    || item.width * item.height > PROMPT3D_REFERENCE_MAX_PIXELS
    || typeof item.originalName !== "string" || !item.originalName || item.originalName.length > 180
    || basename(item.originalName) !== item.originalName || /[\u0000-\u001f\u007f]/.test(item.originalName)
    || (item.view !== undefined && !REFERENCE_VIEWS.includes(item.view))) {
    throw new Error("Reference-image identity is malformed or outside the PNG/JPEG/WebP safety limits.");
  }
}

export function prompt3DReferenceImageSpec(value: Prompt3DReferenceImageSpec): Prompt3DReferenceImageSpec {
  assertPrompt3DReferenceImageSpec(value);
  return {
    version: 1,
    sha256: value.sha256,
    mediaType: value.mediaType,
    byteSize: value.byteSize,
    width: value.width,
    height: value.height,
    originalName: value.originalName,
    ...(value.view === undefined ? {} : { view: value.view }),
  };
}

export function prompt3DReferenceImages(
  referenceImages: Prompt3DReferenceImageSpec[] | undefined,
  legacyReferenceImage?: Prompt3DReferenceImageSpec,
): Prompt3DReferenceImageSpec[] {
  if (referenceImages !== undefined) return referenceImages.map(prompt3DReferenceImageSpec);
  return legacyReferenceImage ? [prompt3DReferenceImageSpec(legacyReferenceImage)] : [];
}

export function assertPrompt3DReferenceImageSet(
  referenceImages: Prompt3DReferenceImageSpec[] | undefined,
  legacyReferenceImage?: Prompt3DReferenceImageSpec,
): void {
  if (referenceImages === undefined) {
    if (legacyReferenceImage !== undefined) assertPrompt3DReferenceImageSpec(legacyReferenceImage);
    return;
  }
  if (!Array.isArray(referenceImages) || referenceImages.length < 1 || referenceImages.length > PROMPT3D_REFERENCE_MAX_COUNT) {
    throw new Error("Choose one to four Hunyuan reference views.");
  }
  const views = new Set<Prompt3DReferenceImageView>();
  const hashes = new Set<string>();
  let totalBytes = 0;
  for (const image of referenceImages) {
    assertPrompt3DReferenceImageSpec(image);
    if (!image.view) throw new Error("Every Hunyuan multiview image must be labelled front, left, back or right.");
    if (views.has(image.view)) throw new Error(`Only one ${image.view} reference view can be supplied.`);
    if (hashes.has(image.sha256)) throw new Error("Each Hunyuan reference view must use distinct image bytes.");
    views.add(image.view);
    hashes.add(image.sha256);
    totalBytes += image.byteSize;
  }
  if (!views.has("front")) throw new Error("Hunyuan multiview conditioning requires a front reference image.");
  if (totalBytes > PROMPT3D_REFERENCE_MAX_TOTAL_BYTES) throw new Error("Reference images exceed the 80 MiB combined safety limit.");
  const front = referenceImages.find((image) => image.view === "front")!;
  if (!legacyReferenceImage || !prompt3DReferenceImageMatches(front, legacyReferenceImage)) {
    throw new Error("The primary reference image must exactly match the labelled front view.");
  }
}

export function prompt3DReferenceImageSetMatches(
  left: Prompt3DReferenceImageSpec[] | undefined,
  right: Prompt3DReferenceImageSpec[] | undefined,
): boolean {
  if (!left || !right) return left === right;
  try {
    return JSON.stringify(left.map(prompt3DReferenceImageSpec)) === JSON.stringify(right.map(prompt3DReferenceImageSpec));
  } catch {
    return false;
  }
}

export function prompt3DReferenceImageMatches(
  left: Prompt3DReferenceImageSpec | undefined,
  right: Prompt3DReferenceImageSpec | undefined,
): boolean {
  if (!left || !right) return left === right;
  try {
    return JSON.stringify(prompt3DReferenceImageSpec(left)) === JSON.stringify(prompt3DReferenceImageSpec(right));
  } catch {
    return false;
  }
}

async function readValidatedReference(sourcePath: string): Promise<ValidatedReference> {
  if (typeof sourcePath !== "string" || !sourcePath || sourcePath.length > 32_767 || !isAbsolute(sourcePath)) {
    throw new Error("Choose an absolute local reference-image path.");
  }
  const path = resolve(sourcePath);
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile() || before.size < 1 || before.size > PROMPT3D_REFERENCE_MAX_BYTES) {
    throw new Error("Reference image must be a regular local file no larger than 20 MiB.");
  }
  const bytes = await readFile(path);
  const after = await stat(path);
  if (!after.isFile() || after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytes.byteLength !== before.size) {
    throw new Error("Reference image changed while it was being read; choose it again.");
  }
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(bytes, {
      failOn: "warning",
      limitInputPixels: PROMPT3D_REFERENCE_MAX_PIXELS,
      animated: false,
    }).metadata();
  } catch (error) {
    throw new Error(`Reference image could not be decoded safely: ${error instanceof Error ? error.message : String(error)}`);
  }
  const mediaType = mediaTypeFor(metadata.format);
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if ((metadata.pages ?? 1) !== 1
    || !Number.isSafeInteger(width) || width < PROMPT3D_REFERENCE_MIN_EDGE || width > PROMPT3D_REFERENCE_MAX_EDGE
    || !Number.isSafeInteger(height) || height < PROMPT3D_REFERENCE_MIN_EDGE || height > PROMPT3D_REFERENCE_MAX_EDGE
    || width * height > PROMPT3D_REFERENCE_MAX_PIXELS) {
    throw new Error("Reference image must be one still frame from 64 to 8192 pixels per side and at most 32 megapixels.");
  }
  const identity: Prompt3DReferenceImageSpec = {
    version: 1,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType,
    byteSize: bytes.byteLength,
    width,
    height,
    originalName: basename(path),
  };
  assertPrompt3DReferenceImageSpec(identity);
  return { bytes, identity };
}

/** Inspect a picker result without retaining its source path in a job or draft. */
export async function inspectPrompt3DReferenceImage(sourcePath: string): Promise<Prompt3DReferenceImageSelection> {
  const { identity } = await readValidatedReference(sourcePath);
  return { ...identity, sourcePath: resolve(sourcePath) };
}

/** Re-read and copy the selected bytes before any hardware/model preflight begins. */
export async function retainPrompt3DReferenceImage(
  selection: Prompt3DReferenceImageSelection,
  jobDirectory: string,
): Promise<Prompt3DRetainedReferenceImage> {
  if (!selection || typeof selection.sourcePath !== "string") throw new Error("Reference-image selection is missing.");
  const expected = prompt3DReferenceImageSpec(selection);
  const validated = await readValidatedReference(selection.sourcePath);
  // A task-contained retained copy deliberately uses a canonical storage name
  // such as reference-front-source.png. Its original picker name remains
  // immutable provenance metadata, but must not make identical retained bytes
  // look changed when they are selected again for an approved successor.
  if (!prompt3DReferenceImageMatches(expected, {
    ...validated.identity,
    originalName: expected.originalName,
    ...(expected.view ? { view: expected.view } : {}),
  })) {
    throw new Error("Reference image changed after selection; choose the file again before generation.");
  }
  const extension = MEDIA_EXTENSION[expected.mediaType];
  const viewPart = expected.view ? `-${expected.view}` : "";
  const path = contained(jobDirectory, resolve(jobDirectory, `reference${viewPart}-source.${extension}`));
  await writeFile(path, validated.bytes, { flag: "wx", mode: 0o600 });
  const copiedAt = new Date().toISOString();
  const retained: Prompt3DRetainedReferenceImage = {
    ...expected,
    path,
    copiedAt,
    use: "hunyuan-shape-concept-conditioning",
  };
  await verifyPrompt3DRetainedReferenceImage(jobDirectory, retained, expected);
  return retained;
}

/** Retain all labelled views before any provider or hardware work starts. */
export async function retainPrompt3DReferenceImages(
  selections: Prompt3DReferenceImageSelection[],
  jobDirectory: string,
): Promise<Prompt3DRetainedReferenceImage[]> {
  assertPrompt3DReferenceImageSet(selections, selections.find((selection) => selection.view === "front"));
  const retained: Prompt3DRetainedReferenceImage[] = [];
  for (const selection of selections) retained.push(await retainPrompt3DReferenceImage(selection, jobDirectory));
  return retained;
}

export async function verifyPrompt3DRetainedReferenceImages(
  jobDirectory: string,
  retained: Prompt3DRetainedReferenceImage[],
  expected: Prompt3DReferenceImageSpec[],
): Promise<void> {
  assertPrompt3DReferenceImageSet(expected, expected.find((image) => image.view === "front"));
  assertPrompt3DReferenceImageSet(retained, retained.find((image) => image.view === "front"));
  if (!prompt3DReferenceImageSetMatches(retained, expected)) {
    throw new Error("Retained Hunyuan reference views do not match the exact AssetSpec inputs.");
  }
  for (let index = 0; index < retained.length; index += 1) {
    await verifyPrompt3DRetainedReferenceImage(jobDirectory, retained[index], expected[index]);
  }
}

/** Re-measure retained source bytes at approval, provider dispatch and reopen. */
export async function verifyPrompt3DRetainedReferenceImage(
  jobDirectory: string,
  retained: Prompt3DRetainedReferenceImage,
  expected: Prompt3DReferenceImageSpec,
): Promise<void> {
  assertPrompt3DReferenceImageSpec(retained);
  assertPrompt3DReferenceImageSpec(expected);
  if (!prompt3DReferenceImageMatches(retained, expected)
    || retained.use !== "hunyuan-shape-concept-conditioning"
    || !Number.isFinite(Date.parse(retained.copiedAt))) {
    throw new Error("Retained reference-image evidence does not match the exact AssetSpec input.");
  }
  const path = contained(jobDirectory, retained.path);
  if (resolve(path) !== resolve(retained.path)
    || extname(path).toLowerCase() !== `.${MEDIA_EXTENSION[retained.mediaType]}`) {
    throw new Error("Retained reference-image path or media type is invalid.");
  }
  const validated = await readValidatedReference(path);
  const contentIdentity = { ...validated.identity, originalName: retained.originalName, ...(retained.view ? { view: retained.view } : {}) };
  if (!prompt3DReferenceImageMatches(retained, contentIdentity)) {
    throw new Error("Retained reference-image bytes no longer match their SHA-256 identity.");
  }
}
