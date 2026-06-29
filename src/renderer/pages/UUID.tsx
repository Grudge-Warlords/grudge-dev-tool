import React, { useEffect, useState } from "react";

export default function UUIDPage() {
  const [slot, setSlot] = useState("Texture");
  const [tier, setTier] = useState<string>("");
  const [itemId, setItemId] = useState(1);
  const [generated, setGenerated] = useState<string | null>(null);
  const [parseInput, setParseInput] = useState("");
  const [parsed, setParsed] = useState<any>(null);
  const [described, setDescribed] = useState<string | null>(null);
  const [slots, setSlots] = useState<Record<string, string>>({});

  useEffect(() => { window.grudge.uuid.slots().then(setSlots); }, []);

  async function gen() {
    const tierNum = tier === "" ? null : Number(tier);
    const r = await window.grudge.uuid.gen({ slot, tier: tierNum, itemId });
    setGenerated(r.uuid);
  }

  async function parse() {
    const p = await window.grudge.uuid.parse(parseInput);
    const d = await window.grudge.uuid.describe(parseInput);
    setParsed(p); setDescribed(d);
  }

  return (
    <div>
      <h1 className="page-title">Grudge UUID</h1>
      <p className="page-sub">Format: <span className="kbd">SLOT-TIER-ITEMID-TIMESTAMP-COUNTER</span></p>

      <div className="card">
        <h3 style={{ margin: "0 0 10px" }}>Generate</h3>
        <div className="row">
          <select value={slot} onChange={(e) => setSlot(e.target.value)}>
            {Object.keys(slots).map((k) => <option key={k} value={k}>{k} → {slots[k]}</option>)}
          </select>
          <input placeholder="Tier (0-8 or empty)" value={tier} onChange={(e) => setTier(e.target.value)} />
          <input type="number" min={1} max={9999} value={itemId} onChange={(e) => setItemId(Number(e.target.value))} />
          <button className="btn" onClick={gen}>Generate</button>
        </div>
        {generated && <div style={{ marginTop: 10 }}><span className="muted">UUID:</span> <code>{generated}</code></div>}
      </div>

      <div className="card">
        <h3 style={{ margin: "0 0 10px" }}>Parse</h3>
        <input placeholder="texr-oo-0001-122501012026-000001" value={parseInput} onChange={(e) => setParseInput(e.target.value)} />
        <div style={{ marginTop: 10 }}><button className="btn" onClick={parse}>Parse</button></div>
        {parsed && <pre>{JSON.stringify(parsed, null, 2)}</pre>}
        {described && <div className="muted">{described}</div>}
      </div>
    </div>
  );
}
