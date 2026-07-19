import React from "react";
import type { AssetRef } from "./types";

/** Chromium ships with a PDF viewer. An <iframe> is the lightest possible
 *  way to embed it — zero JS, zero bytes shipped, full page navigation. */
export default function PdfViewer({ asset }: { asset: AssetRef }) {
  return (
    <iframe
      src={asset.url}
      title={asset.name}
      style={{ width: "100%", height: "100%", border: "none", background: "#1e1e1e" }}
    />
  );
}
