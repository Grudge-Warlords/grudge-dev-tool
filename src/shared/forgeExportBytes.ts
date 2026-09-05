export function normalizeForgeExportBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
    return new Uint8Array(value as ArrayBuffer);
  }

  const serialized = value as { type?: unknown; data?: unknown } | null;
  if (serialized?.type === "Buffer" && Array.isArray(serialized.data)) {
    return Uint8Array.from(serialized.data);
  }

  return null;
}
