import React, { useEffect, useState } from "react";
import { CloudOff, FileText, BookOpen } from "lucide-react";

interface ConnState {
  reachable: boolean;
  online: boolean;
  apiBaseUrl: string;
  error: string | null;
}

/**
 * Renders a one-shot empty-state explaining why a backend-dependent page
 * isn't returning data. Hidden when the connectivity probe says the API is
 * reachable. Use as the *fallback* inside a page; do not gate the entire UI.
 */
export default function DemoModeBanner({ feature }: { feature: string }) {
  const [conn, setConn] = useState<ConnState | null>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      try {
        const initial = await window.grudge?.connectivity?.get?.();
        if (initial) setConn(initial);
      } catch { /* ignore */ }
      off = window.grudge?.connectivity?.onChange?.((s: any) => setConn(s));
    })();
    return () => off?.();
  }, []);

  if (!conn) return null;
  if (conn.reachable) return null;

  return (
    <div className="border border-gold-deep/60 bg-gold/5 rounded-lg p-4 my-3 flex gap-3 items-start">
      <CloudOff className="text-gold mt-0.5 shrink-0" size={20} />
      <div className="flex-1">
        <div className="text-gold font-semibold mb-1">Demo mode — {feature} is unavailable</div>
        <div className="text-muted text-sm mb-2">
          The backend at <span className="font-mono text-ink">{conn.apiBaseUrl}</span> isn't reachable
          {conn.error ? <> (<span className="text-danger">{conn.error}</span>)</> : null}.
          Local features (UUID, ingestion dry-run, BlenderKit) keep working.
        </div>
        <div className="flex gap-3 text-xs">
          <button
            className="flex items-center gap-1 text-gold hover:text-gold/80"
            onClick={() => window.grudge?.diag?.openLogFolder?.()}
          >
            <FileText size={12} /> open logs
          </button>
          <span className="text-muted/60">·</span>
          <span className="text-muted">see <span className="font-mono">docs/dev-tool-quickstart.md</span></span>
        </div>
      </div>
    </div>
  );
}
