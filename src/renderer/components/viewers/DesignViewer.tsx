/**
 * Fallback viewer for design/DCC formats without full in-browser decode
 * (KTX2, HDR, Aseprite, XCF, USDZ, …). Offers system open + convert hints.
 */
import React from "react";
import { toast } from "sonner";
import type { AssetRef } from "./types";
import { basename, formatBytes } from "./types";

export default function DesignViewer({ asset }: { asset: AssetRef }) {
  const name = basename(asset.name);
  const ext = name.split(".").pop()?.toUpperCase() ?? "FILE";
  const note =
    asset.prepareNote ||
    "This format needs a DCC app or convert step for full preview.";

  const openSystem = () => {
    if (asset.sourcePath || asset.localPath) {
      void window.grudge?.files?.openSystem?.(asset.sourcePath || asset.localPath!);
      return;
    }
    void window.grudge?.os?.openExternal?.(asset.url);
  };

  const reveal = () => {
    const p = asset.sourcePath || asset.localPath;
    if (p) void window.grudge?.files?.reveal?.(p);
    else toast.message("No local path to reveal");
  };

  const convertHint = () => {
    if (/\.blend$/i.test(asset.name)) {
      toast.message("Blend → GLB", {
        description: "Install Blender in Settings → Toolchain, then re-open the file.",
      });
      return;
    }
    if (/\.psd$/i.test(asset.name)) {
      toast.message("PSD", {
        description: "Re-open to extract composite PNG, or export PNG from Photoshop.",
      });
      return;
    }
    toast.message("Convert", {
      description: "Use Upload / Skeleton convert, or export PNG/GLB from the authoring app.",
    });
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 32,
        color: "var(--text)",
        background:
          "radial-gradient(ellipse at 50% 30%, rgba(124,107,255,0.12), transparent 55%)",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.12em",
          color: "var(--gold)",
          border: "1px solid var(--gold)",
          borderRadius: 999,
          padding: "4px 14px",
        }}
      >
        {ext}
      </div>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{name}</h2>
      {asset.size > 0 && (
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{formatBytes(asset.size)}</span>
      )}
      <p
        style={{
          maxWidth: 420,
          textAlign: "center",
          color: "var(--muted)",
          fontSize: 13,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {note}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        <Btn onClick={openSystem}>Open with system app</Btn>
        <Btn onClick={reveal}>Reveal in Explorer</Btn>
        <Btn onClick={convertHint}>Convert help</Btn>
      </div>
      <ul
        style={{
          margin: "12px 0 0",
          padding: 0,
          listStyle: "none",
          fontSize: 11,
          color: "var(--muted)",
          textAlign: "center",
          lineHeight: 1.7,
        }}
      >
        <li>
          <strong style={{ color: "var(--text)" }}>PSD / PSB</strong> — auto composite PNG on open
        </li>
        <li>
          <strong style={{ color: "var(--text)" }}>BLEND</strong> — auto GLB via Blender toolchain
        </li>
        <li>
          <strong style={{ color: "var(--text)" }}>KTX2 / HDR / Aseprite</strong> — open in DCC or convert offline
        </li>
      </ul>
    </div>
  );
}

function Btn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "var(--bg-2)",
        border: "1px solid var(--line)",
        color: "var(--text)",
        borderRadius: 6,
        padding: "8px 14px",
        fontSize: 12,
        cursor: "pointer",
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}
