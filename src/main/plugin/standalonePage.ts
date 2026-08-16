/** Standalone plugin panel served at GET / on the dest-tool attach host. */

export function standalonePluginHtml(opts: {
  origin: string;
  token: string;
  version: string;
}): string {
  const { origin, token, version } = opts;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grudge Studio Plugin</title>
  <style>
    :root { --bg:#0a0e1a; --panel:#12182a; --line:#243049; --ink:#e8edf7; --muted:#8b95ab; --gold:#d4a017; --ok:#3ecf8e; }
    * { box-sizing: border-box; }
    html, body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 "Segoe UI", system-ui, sans-serif; }
    header { padding:18px 22px 10px; border-bottom:1px solid var(--line); }
    header h1 { margin:0 0 4px; font-size:18px; letter-spacing:.04em; }
    header p { margin:0; color:var(--muted); }
    .gold { color:var(--gold); }
    main { display:grid; grid-template-columns: 1fr 1fr; gap:14px; padding:16px 22px 28px; }
    @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
    section { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px; }
    h2 { margin:0 0 10px; font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
    button, input, textarea, select {
      background:#0d1322; color:var(--ink); border:1px solid var(--line); border-radius:7px;
      padding:8px 10px; font:inherit;
    }
    button { cursor:pointer; background:#1a2238; }
    button:hover { border-color:var(--gold); }
    .row { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px; }
    textarea { width:100%; min-height:88px; resize:vertical; }
    input { flex:1; min-width:160px; }
    pre { white-space:pre-wrap; word-break:break-word; background:#070b14; padding:10px; border-radius:7px; max-height:280px; overflow:auto; font-size:12px; }
    .ok { color:var(--ok); }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 8px; margin:0 6px 6px 0; font-size:12px; color:var(--muted); }
    .list { max-height:320px; overflow:auto; }
    .item { border-bottom:1px solid var(--line); padding:8px 0; }
    .item b { display:block; }
    .item span { color:var(--muted); font-size:12px; }
  </style>
</head>
<body>
  <header>
    <h1>Grudge Studio <span class="gold">Plugin</span></h1>
    <p>Standalone attach · host <code>${origin}</code> · dest-tool v${version}</p>
    <p id="health">checking…</p>
  </header>
  <main>
    <section>
      <h2>Agentic</h2>
      <textarea id="task" placeholder="Ask the dest-tool agent (Ollama → Puter → keys → Legion)…"></textarea>
      <div class="row">
        <button id="ask">Run agent</button>
        <button id="practicesBtn">Load practices</button>
      </div>
      <pre id="out">(idle)</pre>
    </section>
    <section>
      <h2>Viewer · surfaces</h2>
      <div class="row">
        <input id="path" placeholder="Local path or CDN URL (glb, png, mp4…)" />
        <button id="view">Open viewer</button>
      </div>
      <div class="row">
        <button data-open="forge">Forge</button>
        <button data-open="coder">Coder</button>
        <button data-open="ai">Legion AI</button>
        <button data-open="devtools">Focus dest-tool</button>
      </div>
      <p class="muted">VS Code extension attaches to this same host. Token stays on loopback.</p>
    </section>
    <section style="grid-column:1 / -1">
      <h2>Migrated practices</h2>
      <div id="pills"></div>
      <div class="list" id="plist"></div>
    </section>
  </main>
  <script>
    const TOKEN = ${JSON.stringify(token)};
    const ORIGIN = ${JSON.stringify(origin)};
    async function api(path, body) {
      const res = await fetch(ORIGIN + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + TOKEN,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (!res.ok) throw new Error((data && data.error) || res.status + " " + text.slice(0, 180));
      return data;
    }
    function setOut(v) {
      document.getElementById("out").textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2);
    }
    async function refreshHealth() {
      try {
        const h = await fetch(ORIGIN + "/health").then((r) => r.json());
        document.getElementById("health").innerHTML =
          '<span class="ok">attached</span> · agentic ' + (h.agentic && h.agentic.ready ? "ready" : "fallback") +
          ' · ollama ' + (h.agentic && h.agentic.ollama ? "up" : "down") +
          ' · viewer ' + (h.viewer ? "yes" : "no");
      } catch (e) {
        document.getElementById("health").textContent = String(e);
      }
    }
    async function loadPractices() {
      const data = await api("/v1/practices");
      const list = data.practices || [];
      const sources = [...new Set(list.map((p) => p.source))];
      document.getElementById("pills").innerHTML = sources.map((s) => '<span class="pill">' + s + "</span>").join("");
      document.getElementById("plist").innerHTML = list.map((p) =>
        '<div class="item"><b>' + p.title + '</b><span>[' + p.source + '/' + p.category + '] ' + p.rule + "</span></div>"
      ).join("");
    }
    document.getElementById("ask").onclick = async () => {
      const task = document.getElementById("task").value.trim();
      if (!task) return;
      setOut("running…");
      try {
        const r = await api("/v1/agent/run", { task, role: "dev" });
        setOut((r.response || r.text || "") + (r.source ? "\\n\\n— " + r.source : ""));
      } catch (e) { setOut(String(e)); }
    };
    document.getElementById("practicesBtn").onclick = () => loadPractices().catch((e) => setOut(String(e)));
    document.getElementById("view").onclick = async () => {
      const v = document.getElementById("path").value.trim();
      if (!v) return;
      const body = /^(https?:|assets:)/i.test(v) ? { url: v } : { localPath: v };
      try { setOut(await api("/v1/viewer/open", body)); } catch (e) { setOut(String(e)); }
    };
    for (const btn of document.querySelectorAll("[data-open]")) {
      btn.addEventListener("click", async () => {
        try { setOut(await api("/v1/open", { target: btn.getAttribute("data-open") })); }
        catch (e) { setOut(String(e)); }
      });
    }
    refreshHealth();
    loadPractices().catch(() => {});
  </script>
</body>
</html>`;
}
