/**
 * Fleet ONE TRUTH context for Legion — fetched live, never invented.
 */
import { FLEET_URLS } from "./fleetTruthUrls";

const TRUTH_JSON =
  "https://objectstore.grudge-studio.com/api/v1/_meta/fleet-truth.json";
const MANIFEST_URL = `${FLEET_URLS.gameData}/api/fleet/manifest`;
const AUDIT_URL = `${FLEET_URLS.gameData}/api/fleet/truth-audit`;

const PROBE_TIMEOUT_MS = 8_000;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface FleetTruthSnapshot {
  fleetTruth: Record<string, unknown> | null;
  runtimeManifest: Record<string, unknown> | null;
  truthAudit: {
    score?: number;
    splitBrain?: string[];
    probes?: Array<{ id: string; label: string; ok?: boolean; status?: number; detail?: string }>;
  } | null;
  fetchedAt: string;
}

export async function fetchFleetTruthSnapshot(): Promise<FleetTruthSnapshot> {
  const [fleetTruth, runtimeManifest, truthAudit] = await Promise.all([
    fetchJson<Record<string, unknown>>(TRUTH_JSON),
    fetchJson<Record<string, unknown>>(MANIFEST_URL),
    fetchJson<{
      score?: number;
      splitBrain?: string[];
      probes?: Array<{ id: string; label: string; ok?: boolean; status?: number; detail?: string }>;
    }>(AUDIT_URL),
  ]);

  return {
    fleetTruth,
    runtimeManifest,
    truthAudit,
    fetchedAt: new Date().toISOString(),
  };
}

/** Compact system context block — prepend to Legion infra / fleet questions. */
export async function buildLegionFleetContext(): Promise<string> {
  const snap = await fetchFleetTruthSnapshot();
  const rules = (snap.fleetTruth?.legionRules as string[] | undefined) ?? [
    "Do not invent workers, PRs, or metrics. Use the snapshot below.",
  ];

  const failedProbes =
    snap.truthAudit?.probes?.filter((p) => p.ok === false).map((p) => `${p.label}: ${p.detail ?? p.status}`) ??
    [];

  return [
    "=== GRUDGE FLEET ONE TRUTH (live snapshot) ===",
    `Fetched: ${snap.fetchedAt}`,
    "",
    "Rules:",
    ...rules.map((r) => `- ${r}`),
    "",
    "Truth score:",
    snap.truthAudit?.score != null
      ? `${snap.truthAudit.score}% (min 85)${failedProbes.length ? ` — failures: ${failedProbes.join("; ")}` : ""}`
      : "unavailable — call /api/fleet/truth-audit",
    "",
    "Published fleet-truth.json (excerpt):",
    JSON.stringify(
      {
        version: snap.fleetTruth?.version,
        services: snap.fleetTruth?.services,
        edgeWorkers: snap.fleetTruth?.edgeWorkers,
        deprecated: snap.fleetTruth?.deprecated,
        communication: snap.fleetTruth?.communication,
      },
      null,
      2,
    ),
    "",
    "Runtime manifest urls:",
    JSON.stringify(snap.runtimeManifest?.urls ?? snap.runtimeManifest ?? null, null, 2),
    "=== END FLEET TRUTH ===",
  ].join("\n");
}