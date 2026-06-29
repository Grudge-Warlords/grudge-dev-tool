const FALLBACK = "https://assets.grudge-studio.com";

let cached: string | null = null;

/** Resolve public CDN base via main-process R2 config (cached per session). */
export async function resolveCdnBase(): Promise<string> {
  if (cached) return cached;
  try {
    const url: string = await window.grudge?.cf?.r2PublicUrl?.("");
    cached = (url || FALLBACK).replace(/\/$/, "");
  } catch {
    cached = FALLBACK;
  }
  return cached;
}

export function cdnUrl(base: string, key: string): string {
  const b = base.replace(/\/$/, "");
  const k = key.replace(/^\//, "");
  return `${b}/${k}`;
}

export function resetCdnCache(): void {
  cached = null;
}