import React from "react";

const DOCS = [
  { title: "Quickstart",          file: "dev-tool-quickstart.md" },
  { title: "Object Storage",      file: "object-storage.md" },
  { title: "Grudge UUID System",  file: "grudge-uuid.md" },
  { title: "API Reference",       file: "api-reference.md" },
];

export default function Docs() {
  return (
    <div>
      <h1 className="page-title">Docs</h1>
      <p className="page-sub">Documentation lives in the <span className="kbd">/docs</span> folder of this app and on the studio site.</p>
      <div className="card">
        {DOCS.map((d) => (
          <div key={d.file} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <strong>{d.title}</strong>
            <div className="muted" style={{ fontSize: 12 }}>docs/{d.file}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <p className="muted">
          Tip: open the file directly in your editor — they are plain Markdown so they
          render in any IDE preview. The published Jekyll site lives at
          {" "}<a
            href="#"
            onClick={(e) => { e.preventDefault(); window.grudge?.os?.openExternal?.("https://grudge-warlords.github.io/grudge-dev-tool/"); }}
            className="text-gold"
          >grudge-warlords.github.io/grudge-dev-tool</a>.
        </p>
      </div>
    </div>
  );
}
