// Real Electron transport fixtures. Production workflow acceptance is separate.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, windowsHide: true, stdio: "inherit" });
  child.on("exit", code => process.exit(code ?? 1));
} else { void run(); }
async function run() {
  const { app, BrowserWindow, ipcMain } = require("electron");
  const assert = (await import("node:assert/strict")).default;
  const { mkdtemp, writeFile, mkdir, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { EmbeddedActionBridge } = require(path.join(root, "dist/main/agent/embeddedActionBridge.js"));
  const { appDialogs } = require(path.join(root, "dist/main/agent/appDialogs.js"));
  const { validateAppActionDecision } = require(path.join(root, "dist/shared/appActions.js"));
  const { parseKeys, parsePointer } = require(path.join(root, "dist/shared/appNative.js"));
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const results = [], pass = name => { results.push(name); console.log(`PASS ${name}`); };
  const timeout = setTimeout(() => { console.error("Native actions timed out"); app.exit(1); }, 120000);
  let host, popout, stranger, bridge;
  try {
    const folder = await mkdtemp(path.join(tmpdir(), "grudge-native-actions-"));
    app.setPath("userData", path.join(folder, "profile"));
    await app.whenReady();
    const asset = path.join(folder, "selected.txt"), other = path.join(folder, "other.txt");
    await writeFile(asset, "original asset"); await writeFile(other, "second asset");
    const html = `<!doctype html><style>body{font:16px sans-serif}input,button,textarea,canvas{display:block;margin:8px}canvas{background:#333;width:300px;height:180px}</style>
    <h1>Native control fixture</h1><div aria-label="Asset list" style="height:80px;overflow:auto"><div style="height:700px">Scrollable items</div></div><div class="cm-editor" aria-label="Code editor"><div contenteditable="true" style="white-space:pre-wrap;min-height:30px">const oldValue = 1;</div></div><label>Scene notes<textarea id="notes">Original text</textarea></label>
    <input type="file" aria-label="Local attachment" multiple accept=".txt" id="files"><input type="file" id="hiddenFile" style="display:none"><button onclick="document.getElementById('hiddenFile').click()">Choose hidden input</button><button id="choose" onclick="document.getElementById('files').click()">Choose attachment</button>
    <button onclick="const a=document.createElement('a');a.href='data:application/json,%7B%22scene%22%3A%22downloaded%22%7D';a.download='scene.json';a.click()">Download scene</button>
    <button onclick="document.getElementById('result').textContent=confirm('Save current scene?')?'Scene confirmed':'Scene canceled'">Confirm scene</button>
    <button onclick="document.getElementById('result').textContent=prompt('Scene title','Original')??'Canceled'">Name scene</button>
    <canvas aria-label="Scene canvas" width="300" height="180"></canvas><p role="status" id="result">Ready</p>
    <script>window.events=[];const c=document.querySelector('canvas');for(const name of ['pointerdown','pointermove','pointerup','wheel','contextmenu','dblclick','keydown']) c.addEventListener(name,e=>{window.events.push({type:e.type,trusted:e.isTrusted,x:e.clientX,y:e.clientY,key:e.key});if(e.type==='contextmenu')e.preventDefault();c.getContext('2d').fillRect((e.offsetX||10)-2,(e.offsetY||10)-2,5,5);document.getElementById('result').textContent='Canvas event: '+e.type;});document.getElementById('files').addEventListener('change',e=>{document.getElementById('result').textContent='Selected files: '+[...e.target.files].map(f=>f.name).join(', ')});</script>`;
    const file = path.join(folder, "fixture.html"); await writeFile(file, html);
    host = new BrowserWindow({ show: false, width: 900, height: 800, webPreferences: { sandbox: true, contextIsolation: true } });
    popout = new BrowserWindow({ show: false, width: 900, height: 800, title: "Viewer fixture", webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(root,"dist/preload/guestDialogs.js") } });
    stranger = new BrowserWindow({ show: false });
    await host.loadFile(file); await popout.loadFile(file);
    bridge = new EmbeddedActionBridge(() => null, contents => contents === popout.webContents);
    appDialogs.begin(host.webContents); bridge.native.begin();
    ipcMain.on("appActions:native:syncText",(event,message,value)=>{if(event.sender!==popout.webContents){event.returnValue=null;return;}void appDialogs.request("text",message,value,host.webContents).then(answer=>{event.returnValue=answer;});});
    const observe = (surface = "app") => bridge.observe(host.webContents, { surface, webContentsId: surface === "app" ? 0 : popout.webContents.id });
    const act = async (label, action, value, surface = "app", prompt = "Edit the scene, choose local files, use the keyboard and navigate the canvas") => {
      const o = await observe(surface), c = o.snapshot.controls.find(c => c.label === label); assert.ok(c, label);
      const result = await bridge.execute(host.webContents, { token: o.token, prompt, decision: { action, target: c.id, value, reason: "Exercise native transport", model: "fixture" } }); await pause(120); return result;
    };
    await act("Asset list", "pointer", JSON.stringify({gesture:"wheel",x:.5,y:.5,deltaY:-300}));
    assert.ok(await host.webContents.executeJavaScript(`document.querySelector('[aria-label="Asset list"]').scrollTop>0`));
    await act("Code editor","keys","Ctrl+A");await act("Code editor","type","const answer = 42;\n  // preserved indentation");
    assert.equal(await host.webContents.executeJavaScript(`document.querySelector('.cm-editor [contenteditable]').innerText`),"const answer = 42;\n  // preserved indentation");pass("Scrollable panels and code editor selection/text through original DOM inputs");
    await act("Scene notes", "keys", "Ctrl+A"); await act("Scene notes", "type", "Edited  notes\nwith a second line");
    assert.equal((await observe()).snapshot.controls.find(c => c.label === "Scene notes").value, "Edited  notes\nwith a second line"); pass("Native keyboard selection and exact multiline text input");
    for (const gesture of [{ gesture: "click", x:.5,y:.5 },{ gesture:"double-click",x:.5,y:.5 },{ gesture:"click",x:.5,y:.5,button:"right" },{gesture:"drag",x:.3,y:.4,toX:.7,toY:.6},{gesture:"drag",x:.3,y:.4,toX:.7,toY:.6,button:"middle"},{gesture:"wheel",x:.5,y:.5,deltaY:-120}]) await act("Scene canvas", "pointer", JSON.stringify(gesture));
    await act("Scene canvas", "keys", "F");
    const events = await host.webContents.executeJavaScript("window.events");
    for (const type of ["pointerdown", "pointermove", "pointerup", "wheel", "contextmenu", "dblclick", "keydown"]) assert.ok(events.some(e => e.type === type && e.trusted), type);
    pass("Trusted canvas selection, double click, context menu, orbit/pan drag, zoom and key events");
    await act("Local attachment", "files", JSON.stringify([asset,other]));
    assert.ok((await observe()).snapshot.status.some(s => s.includes("selected.txt, other.txt"))); pass("Actual multiple file input change with existing paths");
    await act("Choose attachment", "click", "");
    for (let i = 0; !appDialogs.observe(host.webContents) && i < 40; i++) await pause(50);
    let d = appDialogs.observe(host.webContents); assert.ok(d, "Chromium chooser is captured");
    await appDialogs.answer(host.webContents, { id: d.id, response:0,paths:[other] }); await pause(150);
    assert.ok((await observe()).snapshot.status.some(s => s.includes("Selected files: other.txt"))); pass("Chromium file chooser completes without a blocking native dialog");
    await act("Choose hidden input","click","");
    for(let i=0;!appDialogs.observe(host.webContents)&&i<40;i++)await pause(50);
    d=appDialogs.observe(host.webContents);assert.ok(d,"Hidden file inputs retain user activation");await appDialogs.answer(host.webContents,{id:d.id,response:0,paths:[asset]});await pause(150);
    assert.equal(await host.webContents.executeJavaScript("document.getElementById('hiddenFile').files[0].name"),"selected.txt");pass("Hidden input chooser receives browser user activation");
    await act("Confirm scene", "click", ""); d = appDialogs.observe(host.webContents); assert.ok(d); await appDialogs.answer(host.webContents, { id:d.id,response:0 }); await pause(150);
    assert.ok((await observe()).snapshot.status.includes("Scene confirmed")); pass("JavaScript confirmation resumes the original handler");
    await act("Name scene", "click", "", "window"); d = appDialogs.observe(host.webContents); assert.ok(d); await appDialogs.answer(host.webContents, { id:d.id,response:0,text:"Retained title" }); await pause(150);
    assert.ok((await observe("window")).snapshot.status.some(s=>s.endsWith("Retained title"))); pass("JavaScript text prompt returns text to the original handler");
    await act("Download scene", "click", "", "app", "Download the scene JSON");
    for(let i=0;!appDialogs.observe(host.webContents)&&i<50;i++)await pause(50);
    d=appDialogs.observe(host.webContents);assert.ok(d,"Blob/download save dialog");
    const listing=await appDialogs.mkdir(host.webContents,d.id,folder,"exports");assert.ok(listing.entries.some(e=>e.name==="exports"));
    const saved=path.join(folder,"exports","scene.json");await appDialogs.answer(host.webContents,{id:d.id,response:0,paths:[saved]});
    for(let i=0;!appDialogs.status(host.webContents).some(s=>s===`File saved: ${saved}`)&&i<50;i++)await pause(50);
    assert.deepEqual(JSON.parse(await readFile(saved,"utf8")),{scene:"downloaded"});pass("Browser export, new folder, chosen destination and completed file evidence");
    let pending = appDialogs.showOpenDialog({ title:"Import text",properties:["openFile","multiSelections"],filters:[{name:"Text",extensions:["txt"]}] });
    d = appDialogs.observe(host.webContents);
    assert.ok((await appDialogs.browse(host.webContents,d.id,folder)).entries.some(e => e.path === asset));
    assert.equal((await appDialogs.browse(host.webContents,d.id,path.join(folder,"missing","nested","file.txt"))).path,folder);
    await assert.rejects(appDialogs.answer(host.webContents,{id:d.id,response:0,paths:[path.join(folder,"missing.txt")]}),/does not exist/);
    await assert.rejects(appDialogs.answer(stranger.webContents,{id:d.id,response:1}),/no longer active/);
    await appDialogs.answer(host.webContents,{id:d.id,response:0,paths:[asset,other]}); assert.deepEqual((await pending).filePaths,[asset,other]); pass("Electron open dialog, folder browsing, multiple selection and ownership checks");
    pending=appDialogs.showSaveDialog({defaultPath:asset,filters:[{name:"Text",extensions:["txt"]}]});d=appDialogs.observe(host.webContents);
    await assert.rejects(appDialogs.answer(host.webContents,{id:d.id,response:0,paths:[asset]}),/already exists/);
    await appDialogs.answer(host.webContents,{id:d.id,response:0,paths:[asset],overwrite:true});assert.equal((await pending).filePath,asset);assert.equal(await readFile(asset,"utf8"),"original asset");pass("Save dialog preserves existing files until explicit overwrite confirmation");
    await act("Scene notes","keys","Ctrl+A","window"); await act("Scene notes","type","Pop-out edited","window");
    assert.equal((await observe("window")).snapshot.controls.find(c=>c.label==="Scene notes").value,"Pop-out edited");
    assert.notEqual((await observe()).snapshot.controls.find(c=>c.label==="Scene notes").value,"Pop-out edited");
    await assert.rejects(bridge.observe(host.webContents,{surface:"window",webContentsId:stranger.webContents.id}),/owned app window/);pass("Pop-out input stays in its bound window; unrelated window rejected");
    const o=await observe();const c=o.snapshot.controls.find(c=>c.label==="Scene canvas");await host.loadFile(file);
    await assert.rejects(bridge.execute(host.webContents,{token:o.token,prompt:"Orbit scene",decision:{action:"pointer",target:c.id,value:'{"gesture":"drag","x":0.3,"y":0.4,"toX":0.7,"toY":0.5}',reason:"Stale",model:"fixture"}}),/APP_CONTROLS_CHANGED/);pass("Native gestures reject observations from a prior document");
    assert.throws(()=>parsePointer('{"gesture":"drag","x":2,"y":0}'));assert.throws(()=>parseKeys("Ctrl+not-a-key"));
    assert.throws(()=>validateAppActionDecision({action:"click",target:"control-1",value:"",reason:"Continue"},{prompt:"Save the scene",history:[],snapshot:{route:"/",controls:[{id:"control-1",label:"Continue",kind:"click",disabled:false,context:"App dialog"}],status:["Delete the existing project?"]}}),/confirmation/);pass("Malformed input and unrelated destructive confirmation rejected");
    pending=appDialogs.showOpenDialog({});appDialogs.end(host.webContents);assert.equal((await pending).canceled,true);pass("Stopping cancels pending dialogs without mutating files");
    const output=path.join(root,".cache/native-actions-20260910");await mkdir(output,{recursive:true});await writeFile(path.join(output,"transport-results.json"),JSON.stringify({at:new Date().toISOString(),evidence:"Real Electron fixtures, not production semantic acceptance",results},null,2));
    console.log(`${results.length} native action checks passed.`);
  } catch(error) {console.error(error);process.exitCode=1;}
  finally {clearTimeout(timeout);if(host)appDialogs.end(host.webContents);await bridge?.native.end();stranger?.destroy();popout?.destroy();host?.destroy();app.exit(process.exitCode??0);}
}
