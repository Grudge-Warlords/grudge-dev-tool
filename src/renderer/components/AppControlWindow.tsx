import React, { useEffect, useState } from "react";
export const appControlWindow = { current: 0 };
export default function AppControlWindow() {
  const [windows, setWindows] = useState<Array<{ id: number; title: string }>>([]), [selected, setSelected] = useState(0);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try { const rows: Array<{ id: number; title: string }> = await window.grudge.embeddedActions.windows(); if (!live) return; setWindows(rows); if (appControlWindow.current && !rows.some(w => w.id === appControlWindow.current)) { appControlWindow.current = 0; setSelected(0); } } catch { /* Closing. */ }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 1000);
    return () => { live = false; clearInterval(timer); appControlWindow.current = 0; };
  }, []);
  if (!windows.length) return null;
  return <label data-app-action-context="App windows" className="fixed bottom-10 right-3 z-[90] rounded border border-line bg-bg-2 p-2 text-xs">Control window <select aria-label="Control window" className="ml-2 max-w-72 bg-bg" value={selected} onChange={e => { appControlWindow.current = Number(e.target.value); setSelected(Number(e.target.value)); }}><option value={0}>Main app</option>{windows.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select></label>;
}
