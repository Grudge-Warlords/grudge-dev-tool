import React, { useEffect, useState } from "react";
import type { AppDialog, AppDialogListing } from "../../shared/appNative";

/** Same dialog for direct use and the prompt controller; no invisible approvals. */
export default function AppDialogPanel() {
  const [dialog, setDialog] = useState<AppDialog | null>(null), [path, setPath] = useState(""), [text, setText] = useState(""), [error, setError] = useState("");
  const [folderName, setFolderName] = useState("");
  const [listing, setListing] = useState<AppDialogListing | null>(null), [offset, setOffset] = useState(0), [overwrite, setOverwrite] = useState(false), [checked, setChecked] = useState(false);
  useEffect(() => {
    let live = true, id = "";
    const refresh = async () => {
      try { const d = await window.grudge.appNative.dialog(); if (!live || id === (d?.id ?? "")) return; id = d?.id ?? ""; setDialog(d); setPath(d?.defaultPath ?? ""); setText(d?.defaultPath ?? ""); setError(""); setListing(null); setFolderName(""); setOffset(0); setOverwrite(false); setChecked(d?.checkboxChecked ?? false); } catch { /* Window is closing. */ }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 200);
    return () => { live = false; clearInterval(timer); };
  }, []);
  if (!dialog) return null;
  const privateText = dialog.kind === "text" && /password|secret|api.?key|credential|access token/i.test(dialog.message);
  async function browse(value: string, page = 0) {
    try { const next = await window.grudge.appNative.browse(dialog!.id, value, page); setListing(next); setOffset(page); setError(""); } catch (e) { setError(String(e)); }
  }
  async function answer(response: number) {
    try { await window.grudge.appNative.answer({ id: dialog!.id, response, paths: path.split(/\r?\n/).map(p => p.trim()).filter(Boolean), text, overwrite, checkboxChecked: checked }); setError(""); } catch (e) { setError(String(e)); }
  }
  return <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60">
    <section role="dialog" aria-modal="true" aria-label={dialog.title} data-app-action-identity={dialog.id} data-app-action-context="App dialog" className="max-h-[90vh] w-[min(680px,95vw)] overflow-auto rounded-xl border border-gold bg-bg-2 p-5 text-fg shadow-2xl">
      <h2 className="text-lg font-semibold">{dialog.title}</h2><p role="status" className="my-3 whitespace-pre-wrap">{dialog.message}</p>
      {dialog.kind === "text" && <label data-app-action-private={privateText ? "true" : undefined}>Dialog text{privateText ? <input type="password" className="block w-full border border-line bg-bg p-2" value={text} onChange={e => setText(e.target.value)}/> : <textarea className="block w-full border border-line bg-bg p-2" value={text} onChange={e => setText(e.target.value)}/>}</label>}
      {["open", "save"].includes(dialog.kind) && <>
        <label>{dialog.multiple ? "Selected paths (one per line)" : "Selected path"}<textarea className="block w-full border border-line bg-bg p-2" value={path} onChange={e => setPath(e.target.value)}/></label>
        {!!dialog.filters.length && <p role="status">Allowed files: {dialog.filters.map(f => `${f.name}: ${f.extensions.join(", ")}`).join("; ")}</p>}
        <button className="my-2 rounded border border-line px-3 py-1" onClick={() => void browse(path)}>Browse folder at selected path</button>
        {listing && <div><p role="status">Folder: {listing.path}</p><button onClick={() => void browse(listing.parent)}>Parent folder</button>{dialog.directory && <button onClick={() => setPath(listing.path)}>Select this folder</button>}
          <div className="my-2 max-h-60 overflow-auto">{listing.entries.map(entry => <button key={entry.path} className="block w-full p-1 text-left hover:bg-bg" aria-label={`${entry.directory ? "Browse folder" : "Select file"} ${entry.name}`} onClick={() => entry.directory ? void browse(entry.path) : setPath(old => dialog.multiple && old && old !== dialog.defaultPath ? `${old}\n${entry.path}` : entry.path)}>{entry.directory ? "Folder: " : ""}{entry.name}</button>)}</div>
          {dialog.createDirectory && <div><label>New folder name<input className="border border-line bg-bg" value={folderName} onChange={e => setFolderName(e.target.value)}/></label><button disabled={!folderName.trim()} onClick={() => void window.grudge.appNative.mkdir(dialog.id, listing.path, folderName).then((next: AppDialogListing) => { setListing(next); setFolderName(""); setError(""); }).catch((e: unknown) => setError(String(e)))}>Create folder</button></div>}
          {offset > 0 && <button onClick={() => void browse(listing.path, Math.max(0, offset - 80))}>Previous files</button>}{listing.more && <button onClick={() => void browse(listing.path, offset + 80)}>More files</button>}
        </div>}
        {dialog.kind === "save" && <label className="block"><input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)}/> Replace existing file</label>}
      </>}
      {dialog.checkboxLabel && <label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}/>{dialog.checkboxLabel}</label>}
      {error && <p role="alert" className="my-2 text-red-400">{error}</p>}
      <div className="mt-4 flex gap-3">{dialog.buttons.map((button, index) => <button className="rounded border border-line px-4 py-2" key={index} onClick={() => void answer(index)}>{button}</button>)}</div>
    </section>
  </div>;
}
