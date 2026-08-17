/**
 * Player-account cloud handoff — same Puter Space for every game/editor.
 * Live: https://ai.grudge-studio.com/puter-space
 *
 * Law: this is User-Pays FS + puter.site deploy. Railway still owns bag /
 * characters / wallet. Do not invent a second roster here.
 */
import { FLEET_URLS } from "./fleet";

export const PUTER_SPACE_ORIGIN = FLEET_URLS.puterSpace;

export function puterSpaceUrl(extra?: Record<string, string>): string {
  const u = new URL(PUTER_SPACE_ORIGIN);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) u.searchParams.set(k, v);
    }
  }
  return u.toString();
}

export function puterSpaceFromSurface(from: string): string {
  return puterSpaceUrl({ from, intent: "account-cloud" });
}
