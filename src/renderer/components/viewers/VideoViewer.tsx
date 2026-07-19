import React from "react";
import type { AssetRef } from "./types";

/** HTML5 video player — Chromium handles mp4, webm, mov, m4v natively with
 *  hardware acceleration. Nothing to optimise here. */
export default function VideoViewer({ asset }: { asset: AssetRef }) {
  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "#000",
    }}>
      <video
        src={asset.url}
        controls
        autoPlay={false}
        playsInline
        preload="metadata"
        style={{ maxWidth: "100%", maxHeight: "100%", background: "#000" }}
      />
    </div>
  );
}
