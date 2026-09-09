// Real Electron webview/isolated-world regression tests. Fixture pages are not
// evidence that connected Forge, Coder or other production apps completed work.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, windowsHide: true, stdio: "inherit" });
  child.on("exit", code => process.exit(code ?? 1));
} else {
  // Do not hold Electron's ESM startup evaluation open while awaiting ready.
  void runHarness();
}
async function runHarness() {
  const { app, BrowserWindow, session } = require("electron");
  const watchdog = setTimeout(() => { console.error("Embedded fixture timed out"); app.exit(1); }, process.env.GRUDGE_TEST_EMBEDDED_PLANNER === "1" || process.env.GRUDGE_TEST_EMBEDDED_SELECTION === "1" || process.env.GRUDGE_TEST_EMBEDDED_PROPERTY === "1" ? 600_000 : 90_000);
  console.log("Starting embedded Electron regression harness");
  const assert = (await import("node:assert/strict")).default;
  const { mkdir, writeFile, mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { EmbeddedActionBridge } = require(path.join(root, "dist/main/agent/embeddedActionBridge.js"));
  const { EMBEDDED_SURFACES, embeddedUrlAllowed, embeddedPromptScope } = require(path.join(root, "dist/shared/embeddedActions.js"));
  const results = [];
  const record = name => { results.push({ name, passed: true }); console.log(`PASS ${name}`); };
  let host, other;
  try {
    app.setPath("userData", await mkdtemp(path.join(tmpdir(), "grudge-embedded-test-")));
    await app.whenReady();
    console.log("Electron ready");
    const partition = `embedded-test-${Date.now()}`;
    const html = `<!doctype html><style>body{font:16px sans-serif}label,button,input,select,div[role=textbox]{display:block;margin:8px}div[role=textbox]{min-height:24px;border:1px solid;white-space:pre-wrap}</style>
      <h1>Embedded fixture</h1><label>Scene name<input value="Draft" id="name"></label>
      <label>Exposure<input type="number" min="0" max="2" step=".05" value="1" id="exposure"></label>
      <label>Style<select id="style"><option>Day</option><option>Night</option></select></label>
      <button role="switch" aria-label="Grid" aria-checked="false" onclick="this.setAttribute('aria-checked',this.getAttribute('aria-checked')==='true'?'false':'true')">Grid</button>
      <span id="notes-label">Notes</span><div role="textbox" contenteditable="true" aria-labelledby="notes-label">Old notes</div>
      <button onclick="document.querySelector('[role=status]').textContent='Saved scene: '+document.getElementById('name').value">Save scene</button>
      <button>Publish</button><button disabled>Unavailable</button><input type="password" aria-label="Password" value="must-not-read"><label>API key<input value="must-not-read"></label>
      <details><summary>Advanced</summary><button>Hidden operation</button></details><div role="status">Scene ready</div>
      <div class="left-drag-content"><div class="tab-item is-active" title="Prefabs and primitives"><span>Place</span></div><div class="drag-item" draggable="true" aria-label="Box" data-app-action-drag="true" ondragstart="event.dataTransfer.setData('text/plain','Box')"><div>Box</div></div></div>
      <div id="scene-render" data-app-action-drop="true" aria-label="Scene viewport" style="height:120px;background:#ddd" ondragover="event.preventDefault()" ondrop="event.preventDefault();const name=event.dataTransfer.getData('text/plain');document.querySelector('[role=status]').textContent='Placed '+name;const node=document.createElement('div');node.className='el-tree-node__content';node.textContent=name;document.querySelector('.scene-content-tree').append(node)">Scene viewport</div><div class="scene-content-tree"><div class="el-tree-node__content">Camera</div></div>`;
    await session.fromPartition(partition).protocol.handle("https", () => new Response(html, { headers: { "content-type": "text/html" } }));
    host = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await host.loadURL("about:blank");
    const attached = new Promise(resolve => host.webContents.once("did-attach-webview", (_, guest) => resolve(guest)));
    await host.webContents.executeJavaScript(`document.body.innerHTML='<webview style="width:900px;height:600px" partition="${partition}" src="https://forge.grudge-studio.com/editor"></webview>'`);
    const guest = await attached;
    if (guest.isLoadingMainFrame()) await new Promise(resolve => guest.once("did-finish-load", resolve));
    const bridge = new EmbeddedActionBridge();
    const observe = async surface => {
      for (let i = 0; guest.isLoadingMainFrame() && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 50));
      return bridge.observe(host.webContents, { surface, webContentsId: guest.id });
    };
    const apply = (o, label, value, prompt = `Set ${label} to ${value}`) => {
      const control = o.snapshot.controls.find(c => c.label === label); assert.ok(control, label);
      return bridge.execute(host.webContents, { token: o.token, prompt, decision: { action: control.kind === "click" ? "click" : "set", target: control.id, value: control.kind === "click" ? "" : value, reason: "Exercise fixture control", model: "test" } });
    };
    for (const [surface, config] of Object.entries(EMBEDDED_SURFACES)) {
      await guest.loadURL(config.origins[0] + "/editor");
      const o = await observe(surface);
      assert.ok(o.snapshot.controls.some(c => c.label === "Scene name" && c.context.startsWith(`Embedded ${config.name}`)));
      assert.ok(o.snapshot.controls.every(c => !/Password|API key|Hidden operation/.test(c.label)));
      assert.ok(!JSON.stringify(o).includes("must-not-read"));
      await apply(o, "Scene name", `${config.name} scene`);
      await apply(await observe(surface), "Exposure", "1.35");
      await apply(await observe(surface), "Style", "Night");
      await apply(await observe(surface), "Grid", "true");
      await apply(await observe(surface), "Notes", "two  spaces\nand a new line");
      const beforeSave = await observe(surface);
      assert.equal(beforeSave.snapshot.controls.find(c => c.label === "Grid").value, "true");
      assert.equal(beforeSave.snapshot.controls.find(c => c.label === "Notes").value, "two  spaces\nand a new line");
      await apply(beforeSave, "Save scene", "", "Save the current scene");
      assert.ok((await observe(surface)).snapshot.status.includes(`Embedded ${config.name}: Saved scene: ${config.name} scene`));
      record(`${surface}: observe, text, numeric, select, ARIA toggle, multiline editor, save result`);
      if (process.env.GRUDGE_TEST_EMBEDDED_PLANNER === "1") {
        const { planAppAction } = require(path.join(root, "dist/main/agent/appActionPlanner.js"));
        const prompt = `In ${config.name}, set Scene name to "Grudge ${config.name}" and Exposure to 1.15.`;
        const history = []; let finished = false;
        for (let step = 0; step < 5; step++) {
          const observed = await observe(surface);
          const decision = await planAppAction({ prompt, snapshot: observed.snapshot, history });
          assert.match(decision.model, /grudge/i);
          if (decision.action === "done") { finished = true; break; }
          assert.equal(decision.action, "set");
          const result = await bridge.execute(host.webContents, { token: observed.token, prompt, decision });
          history.push({ action: `set ${decision.target} ${decision.value}`, result });
        }
        assert.ok(finished, "The real Grudge planner must verify completion");
        assert.equal(history.length, 2);
        const final = (await observe(surface)).snapshot;
        assert.equal(final.controls.find(c => c.label === "Scene name").value, `Grudge ${config.name}`);
        assert.equal(final.controls.find(c => c.label === "Exposure").value, "1.15");
        record(`${surface}: real Grudge compound prompt executed and verified both settings`);
        if (surface === "threeflow") {
          const placementHistory = [], placementPrompt = "In ThreeFlow, add a box to the scene.";
          for (let step = 0; step < 3; step++) {
            const observed = await observe(surface);
            const decision = await planAppAction({ prompt: placementPrompt, snapshot: observed.snapshot, history: placementHistory });
            assert.match(decision.model, /grudge/i);
            if (decision.action === "done") break;
            assert.equal(decision.action, "drag");
            const result = await bridge.execute(host.webContents, { token: observed.token, prompt: placementPrompt, decision });
            placementHistory.push({ action: `drag ${decision.target} ${decision.value}`, result });
          }
          assert.equal(placementHistory.length, 1);
          assert.ok((await observe(surface)).snapshot.status.some(s => /Scene hierarchy: Camera; Box/.test(s)));
          record("threeflow: real Grudge prompt places a new object and verifies hierarchy growth");
        }
      }
    }
    await guest.loadURL(`${EMBEDDED_SURFACES.threeflow.origins[0]}/editor`);
    await guest.executeJavaScript(`(() => {
      const hud=document.createElement('div');hud.className='tf-status';hud.innerHTML='<span>SI</span><span data-app-action-selected-object>BoxGeometry</span><span>Translate</span>';document.body.prepend(hud);
      const panel=document.createElement('div');panel.className='property-content';panel.innerHTML='<div class="property-item"><div class="property-item-label">Name</div><div><input value="BoxGeometry"></div></div><div class="property-item"><div class="property-item-label">Position</div><div>'+['X','Y','Z'].map(axis=>'<div class="input-content"><span>'+axis+'</span><input type="number" value="0" step=".001"></div>').join('')+'</div></div><div class="property-item"><div class="property-item-label">Visible</div><button role="switch" aria-checked="true">Toggle</button></div>';
      document.body.prepend(panel);
    })()`);
    const propertyBefore = await observe("threeflow");
    for (const name of ["Name", "Position X", "Position Y", "Position Z", "Visible"]) assert.ok(propertyBefore.snapshot.controls.some(c => c.label === name));
    await apply(propertyBefore, "Position X", "3");
    assert.equal((await observe("threeflow")).snapshot.controls.find(c => c.label === "Position X").value, "3");
    record("ThreeFlow property labels and separate axis fields expose their existing inputs");
    const oldSelection = await observe("threeflow");
    await guest.executeJavaScript("document.querySelector('[data-app-action-selected-object]').textContent='Camera'");
    await assert.rejects(apply(oldSelection, "Position X", "4"), /APP_CONTROLS_CHANGED/);
    record("Changed selected object rejects a stale property edit even when its value matches");
    if (process.env.GRUDGE_TEST_EMBEDDED_PROPERTY === "1") {
      const { planAppAction } = require(path.join(root, "dist/main/agent/appActionPlanner.js"));
      await guest.executeJavaScript(`(() => {
        const panel=document.querySelector('.property-content');panel.style.display='none';panel.querySelector('[aria-label="Position X"]').value='0';
        const tab=document.createElement('button');tab.textContent='Properties';tab.setAttribute('role','tab');tab.setAttribute('aria-selected','false');tab.onclick=()=>{panel.style.display='block';tab.setAttribute('aria-selected','true');};document.body.prepend(tab);
      })()`);
      const prompt = 'In ThreeFlow, set Name to "Coverage Box" and Position X to 3.', history = [];
      let finished = false;
      for (let step = 0; step < 5; step++) {
        const observed = await observe("threeflow"), decision = await planAppAction({ prompt, snapshot: observed.snapshot, history });
        assert.match(decision.model, /grudge/i);
        if (decision.action === "done") { finished = true; break; }
        assert.equal(decision.action, step === 0 ? "click" : "set");
        assert.equal(observed.snapshot.controls.find(c => c.id === decision.target)?.label, ["Properties", "Name", "Position X"][step]);
        history.push({ action: `${decision.action} ${decision.target} ${decision.value}`, result: await bridge.execute(host.webContents, { token: observed.token, prompt, decision }) });
      }
      assert.ok(finished); assert.equal(history.length, 3);
      const final = (await observe("threeflow")).snapshot;
      assert.equal(final.controls.find(c => c.label === "Name").value, "Coverage Box");
      assert.equal(final.controls.find(c => c.label === "Position X").value, "3");
      assert.equal(final.controls.find(c => c.label === "Scene name").value, "Draft", "Unrelated inputs remain unchanged");
      record("Real Grudge opens the property panel and changes exactly the two requested fields");
    }
    if (process.env.GRUDGE_TEST_EMBEDDED_SELECTION === "1") {
      const { planAppAction } = require(path.join(root, "dist/main/agent/appActionPlanner.js"));
      await guest.loadURL(`${EMBEDDED_SURFACES.threeflow.origins[0]}/editor`);
      await guest.executeJavaScript(`(() => {
        const hud=document.createElement('div');hud.className='tf-status';hud.innerHTML='<span>SI</span><span>1 node</span><span>nothing selected</span><span>Translate</span>';document.body.prepend(hud);
        const tree=document.querySelector('.scene-content-tree');tree.innerHTML='<div role="treeitem"><div class="el-tree-node__content">Camera</div></div>';
        tree.firstElementChild.onclick=()=>hud.children[2].textContent='Camera';
        document.getElementById('scene-render').ondrop=event=>{event.preventDefault();hud.children[2].textContent=event.dataTransfer.getData('text/plain')+'Geometry';};
      })()`);
      for (let run = 0; run < 2; run++) {
        const history = [], prompt = "In ThreeFlow, add a box to the scene.";
        let finished = false;
        for (let step = 0; step < 4; step++) {
          const observed = await observe("threeflow");
          const decision = await planAppAction({ prompt, snapshot: observed.snapshot, history });
          assert.match(decision.model, /grudge/i);
          if (decision.action === "done") { finished = true; break; }
          assert.equal(decision.action, run === 1 && step === 0 ? "click" : "drag");
          if (decision.action === "click") assert.equal(observed.snapshot.controls.find(c => c.id === decision.target)?.label, "Select Camera");
          history.push({ action: `${decision.action} ${decision.target} ${decision.value}`, result: await bridge.execute(host.webContents, { token: observed.token, prompt, decision }) });
        }
        assert.ok(finished, "Changed selection must be verified without a second drag");
        assert.equal(history.filter(h => h.action.startsWith("drag ")).length, 1);
        assert.equal(await guest.executeJavaScript("document.querySelectorAll('.scene-content-tree .el-tree-node__content').length"), 1, "Fixture reproduces the stale production hierarchy");
        record(run === 0 ? "Real Grudge verifies placement using changed public selection despite stale hierarchy" : "Real Grudge selects Camera before placing another box and verifies the new selection");
      }
    }
    await guest.loadURL("https://forge.grudge-studio.com/editor");
    let o = await observe("forge");
    await assert.rejects(apply(o, "Publish", "", "Save locally"), /explicit request/); record("Publication requires original prompt intent");
    o = await observe("forge");
    await assert.rejects(apply(o, "Exposure", "9"), /not valid/);
    assert.equal((await observe("forge")).snapshot.controls.find(c => c.label === "Exposure").value, "1"); record("Invalid numeric values leave controls unchanged");
    o = await observe("forge");
    await guest.executeJavaScript("document.getElementById('name').value='Changed during planning'");
    await assert.rejects(apply(o, "Scene name", "Overwrite"), /APP_CONTROLS_CHANGED/); record("Changed values reject stale actions");
    o = await observe("forge");
    await guest.executeJavaScript(`(() => { const item=document.querySelector('.left-drag-content'); const pane=document.createElement('div'); pane.id='fixture-scroll-pane'; pane.style.cssText='position:fixed;left:10px;top:10px;width:180px;height:70px;overflow:auto;background:white;z-index:10'; const spacer=document.createElement('div'); spacer.style.height='180px'; pane.append(spacer,item); document.body.append(pane); })()`);
    o = await observe("forge");
    assert.ok(o.snapshot.controls.some(c => c.label === "Box"), "Scroll-clipped catalog sources remain reachable"); record("Catalog controls behind a scroll boundary remain available");
    const source = o.snapshot.controls.find(c => c.label === "Box"), destination = o.snapshot.controls.find(c => c.label === "Scene viewport");
    await bridge.execute(host.webContents, { token: o.token, prompt: "Place Box in the scene", decision: { action: "drag", target: source.id, value: destination.id, reason: "Place requested box", model: "test" } });
    assert.ok((await observe("forge")).snapshot.status.includes("Embedded Forge: Placed Box")); record("Observed drag source reaches the existing drop handler");
    await guest.executeJavaScript(`(() => { const modal=document.createElement('div'); modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.style.cssText='position:fixed;inset:0;background:white;z-index:20'; const close=document.createElement('button'); close.textContent='Close fixture dialog'; close.onclick=()=>modal.remove(); modal.append(close); document.body.append(modal); })()`);
    o = await observe("forge");
    assert.ok(!o.snapshot.controls.some(c => c.label === "Box"));
    await apply(o, "Close fixture dialog", "", "Close the dialog"); record("Covered controls stay unavailable until the actual modal closes");
    await guest.executeJavaScript(`(() => { const b=document.getElementById('scene-render').getBoundingClientRect(); const cover=document.createElement('div');cover.id='fixture-centre-cover';cover.style.cssText='position:fixed;z-index:30;background:black';Object.assign(cover.style,{left:(b.left+b.width*.45)+'px',top:(b.top+b.height*.45)+'px',width:(b.width*.1)+'px',height:(b.height*.1)+'px'});document.body.append(cover); })()`);
    o = await observe("forge");
    const uncoveredSource = o.snapshot.controls.find(c => c.label === "Box"), uncoveredDrop = o.snapshot.controls.find(c => c.label === "Scene viewport");
    assert.ok(uncoveredDrop, "An exposed part of the viewport stays available");
    await bridge.execute(host.webContents, { token: o.token, prompt: "Place Box into Scene viewport", decision: { action: "drag", target: uncoveredSource.id, value: uncoveredDrop.id, reason: "Use visible viewport", model: "test" } });
    assert.equal(await guest.executeJavaScript("document.querySelectorAll('.scene-content-tree .el-tree-node__content').length"), 3);
    await guest.executeJavaScript("document.getElementById('fixture-centre-cover').remove();true"); record("Partially covered viewport uses an exposed drop point");
    await guest.executeJavaScript("const pane=document.getElementById('fixture-scroll-pane');document.body.append(pane.querySelector('.left-drag-content'));pane.remove();true");
    o = await observe("forge");
    await guest.executeJavaScript("document.querySelector('[role=textbox]').style.whiteSpace='normal'");
    o = await observe("forge");
    await assert.rejects(apply(o, "Notes", "two  spaces"), /collapses whitespace/); record("Whitespace-collapsing editors reject lossy text before mutation");
    o = await observe("forge");
    await guest.executeJavaScript("history.pushState({},'', '/other')");
    await assert.rejects(apply(o, "Scene name", "Overwrite"), /APP_CONTROLS_CHANGED/); record("In-page navigation rejects stale actions");
    o = await observe("forge");
    await guest.loadURL(guest.getURL());
    for (let i = 0; guest.isLoadingMainFrame() && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 50));
    await assert.rejects(apply(o, "Scene name", "Overwrite"), /APP_CONTROLS_CHANGED/); record("Same-URL reload rejects stale document actions");
    o = await observe("forge");
    await apply(o, "Scene name", "Once");
    await assert.rejects(apply(o, "Scene name", "Twice"), /expired/); record("Action receipts cannot be replayed");
    if (process.env.GRUDGE_TEST_EMBEDDED_ONCE === "1") {
      const { planAppAction } = require(path.join(root, "dist/main/agent/appActionPlanner.js"));
      const prompt = "In Forge, click the Save scene button once.", history = [];
      o = await observe("forge");
      const click = await planAppAction({ prompt, snapshot: o.snapshot, history });
      assert.equal(click.action, "click"); assert.match(click.model, /grudge/i);
      history.push({ action: `click ${click.target} `, result: await bridge.execute(host.webContents, { token: o.token, prompt, decision: click }) });
      const finish = await planAppAction({ prompt, snapshot: (await observe("forge")).snapshot, history });
      assert.equal(finish.action, "done"); assert.match(finish.model, /grudge/i);
      assert.equal(finish.reason, "Activated Save scene once.", "A click receipt cannot invent scene-save or hierarchy evidence");
      record("Real Grudge click-once request completes without pressing the button twice");
    }
    await guest.executeJavaScript("window.__grudgeEmbeddedActions={observe(){throw Error('tampered')}}; true");
    assert.ok((await observe("forge")).snapshot.controls.length); record("Page scripts cannot replace the isolated bridge");
    other = new BrowserWindow({ show: false });
    await assert.rejects(bridge.observe(other.webContents, { surface: "forge", webContentsId: guest.id }), /does not belong/); record("Other windows cannot operate a guest");
    await guest.loadURL("https://unrelated.example/editor");
    await assert.rejects(observe("forge"), /supported origins/); record("Unrelated origins cannot expose controls");
    assert.equal(embeddedUrlAllowed("forge", "https://forge.grudge-studio.com.evil.example"), false);
    assert.equal(embeddedUrlAllowed("forge", "https://user:password@forge.grudge-studio.com"), false);
    assert.equal(embeddedUrlAllowed("coder", "http://localhost:5111"), false);
    assert.equal(embeddedUrlAllowed("coder", "http://localhost:5111", "http://localhost:5111"), true);
    assert.deepEqual(embeddedPromptScope('Open Forge and set Scene name to "Evening".'), { surface: "forge", prompt: 'set Scene name to "Evening".' });
    assert.equal(embeddedPromptScope("Do not open Forge and delete the scene"), null); record("Origin and compound destination parsing");
    const output = path.join(root, `.cache/prompt-e2e-20260909/phase5-${process.env.GRUDGE_TEST_EMBEDDED_PLANNER === "1" ? "grudge-" : process.env.GRUDGE_TEST_EMBEDDED_ONCE === "1" ? "once-" : process.env.GRUDGE_TEST_EMBEDDED_SELECTION === "1" ? "selection-" : process.env.GRUDGE_TEST_EMBEDDED_PROPERTY === "1" ? "property-" : ""}embedded-fixtures.json`);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({ at: new Date().toISOString(), evidence: "Real Electron transport with synthetic guest controls; not production-app acceptance", results }, null, 2));
    console.log(`${results.length} embedded transport checks passed.`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(watchdog); other?.destroy(); host?.destroy(); app.exit(process.exitCode ?? 0); }
}
