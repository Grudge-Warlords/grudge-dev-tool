// Optional real-editor integration check. The supplied loopback build is replayed
// in a private session at the allowlisted origin; this is NOT production evidence.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [fileURLToPath(import.meta.url)], {env, windowsHide:true, stdio:'inherit'});
  child.on('exit', code => process.exit(code ?? 1));
} else { void run(); }

async function run() {
  const { app, BrowserWindow, session, net } = require('electron');
  const { mkdir, mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const assert = (await import('node:assert/strict')).default;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = path.join(root, '.cache/prompt-e2e-20260909/phase5-threeflow-integration');
  const watchdog = setTimeout(() => { console.error('ThreeFlow integration timed out'); app.exit(1); }, 600_000);
  let host;
  const workflows = [];
  try {
    const local = new URL(process.env.GRUDGE_TEST_THREEFLOW_ORIGIN || '');
    assert.ok(local.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(local.hostname) && !local.username && !local.password, 'Explicit loopback editor build required');
    await mkdir(output, {recursive:true});
    app.setPath('userData', await mkdtemp(path.join(tmpdir(), 'grudge-threeflow-integration-')));
    await app.whenReady();
    const partition = `threeflow-integration-${Date.now()}`;
    await session.fromPartition(partition).protocol.handle('https', request => {
      const url = new URL(request.url);
      return url.origin === 'https://threeflow.vercel.app'
        ? fetch(new URL(url.pathname + url.search, local.origin))
        : net.fetch(request, {bypassCustomProtocolHandlers:true});
    });
    host = new BrowserWindow({show:false, width:1440, height:900, webPreferences:{webviewTag:true, sandbox:true, contextIsolation:true, nodeIntegration:false}});
    await host.loadURL('about:blank');
    const attached = new Promise(resolve => host.webContents.once('did-attach-webview', (_, guest) => resolve(guest)));
    await host.webContents.executeJavaScript(`document.body.style.margin='0';document.body.innerHTML='<webview style="width:1440px;height:880px" partition="${partition}" src="https://threeflow.vercel.app/editor"></webview>'`);
    const guest = await attached;
    guest.setBackgroundThrottling(false);
    const { EmbeddedActionBridge } = require(path.join(root, 'dist/main/agent/embeddedActionBridge.js'));
    const { planAppAction } = require(path.join(root, 'dist/main/agent/appActionPlanner.js'));
    const bridge = new EmbeddedActionBridge();
    const observe = () => bridge.observe(host.webContents, {surface:'threeflow', webContentsId:guest.id});
    const waitFor = async (predicate, message) => {
      for (let i=0; i<150; i++) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(message);
    };
    await waitFor(async () => !guest.isLoadingMainFrame() && await guest.executeJavaScript(`Boolean(document.querySelector('.scene-content-tree')) && !document.body.innerText.includes('First load can take')`), 'Editor did not become ready');
    for (const prompt of [
      'In ThreeFlow, add a box to the scene.',
      'In ThreeFlow, set Name to "Integration Box" and Position X to 3.',
      'In ThreeFlow, click the Save button once.',
    ]) {
      const history = [];
      const record = {prompt, history, passed:false}; workflows.push(record);
      let done = false;
      for (let step=0; step<12; step++) {
        const observation = await observe();
        const decision = await planAppAction({prompt, snapshot:observation.snapshot, history});
        console.log(JSON.stringify({prompt, step, decision}));
        if (decision.action === 'done') { record.reason = decision.reason; done = true; break; }
        assert.notEqual(decision.action, 'blocked', decision.reason);
        if (decision.action === 'wait') { await new Promise(resolve => setTimeout(resolve, 300)); continue; }
        const result = await bridge.execute(host.webContents, {token:observation.token, prompt, decision});
        history.push({action:`${decision.action} ${decision.target} ${decision.value}`, result});
        assert.ok(!result.startsWith('Control changed'), result);
        if (result.startsWith('Activated Save in embedded ')) {
          await waitFor(() => guest.executeJavaScript(`document.body.innerText.includes('Scene saved')`), 'Save did not report completion');
        }
      }
      assert.ok(done, 'Prompt did not finish'); record.passed = true;
    }
    assert.equal(workflows[0].history.filter(h => h.action.startsWith('drag ')).length, 1);
    assert.equal(workflows[2].history.length, 1);
    assert.equal(workflows[2].reason, 'Activated Save once.');
    const beforeReload = (await observe()).documentId;
    const reloaded = new Promise(resolve => guest.once('did-finish-load', resolve));
    guest.reload();
    await reloaded;
    await waitFor(async () => !guest.isLoadingMainFrame() && await guest.executeJavaScript(`Boolean(document.querySelector('.scene-content-tree')) && document.querySelector('.scene-content-tree').innerText.includes('Integration Box') && !document.body.innerText.includes('First load can take')`), 'Saved box missing after reload');
    let observation = await observe();
    assert.notEqual(observation.documentId, beforeReload, 'Reload must create a new editor document');
    const tree = observation.snapshot.controls.filter(c => c.kind === 'click' && c.label.includes('Integration Box'));
    assert.equal(tree.length, 1, 'Saved tree item is uniquely actionable');
    await bridge.execute(host.webContents, {token:observation.token, prompt:'Select Integration Box', decision:{action:'click', target:tree[0].id, value:'', reason:'Inspect saved object', model:'test-verification'}});
    observation = await observe();
    const properties = observation.snapshot.controls.find(c => c.label === 'Properties');
    if (properties?.value !== 'true') await bridge.execute(host.webContents, {token:observation.token, prompt:'Open Properties', decision:{action:'click', target:properties.id, value:'', reason:'Inspect saved properties', model:'test-verification'}});
    const restored = (await observe()).snapshot;
    assert.equal(restored.controls.find(c => c.label === 'Name')?.value, 'Integration Box');
    assert.equal(Number(restored.controls.find(c => c.label === 'Position X')?.value), 3);
    await guest.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await writeFile(path.join(output, 'restored.png'), (await guest.capturePage()).toPNG());
    await writeFile(path.join(output, 'results.json'), JSON.stringify({source:local.origin, production:false, workflows, restored}, null, 2));
    console.log('PASS three real Grudge workflows against the local repaired editor and saved-name/position reload');
    clearTimeout(watchdog); host.destroy(); app.exit(0);
  } catch (error) {
    console.error(error);
    await writeFile(path.join(output, 'failed.json'), JSON.stringify({workflows, error:String(error)}, null, 2)).catch(() => {});
    clearTimeout(watchdog); host?.destroy(); app.exit(1);
  }
}
