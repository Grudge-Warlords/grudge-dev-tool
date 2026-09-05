import * as React from "react";
import type { AssetSpecV1 } from "../../shared/prompt3d";
import { compilePrompt3DPrompt, COMPONENT_LABELS, OBJECT_PROFILES, OBJECT_TYPES, resolveObjectRules, type Prompt3DComponent, type Prompt3DObjectRules, type Prompt3DObjectType } from "../../shared/prompt3dRules";

export default function Prompt3DRulesPanel({ spec, onChange }: { spec: AssetSpecV1; onChange: (rules: Prompt3DObjectRules) => void }) {
  const rule = resolveObjectRules(spec);
  let plan: ReturnType<typeof compilePrompt3DPrompt> | null = null;
  let promptError = "";
  try {
    plan = compilePrompt3DPrompt(spec);
  } catch (error) {
    promptError = error instanceof Error ? error.message : String(error);
  }
  const choice: Prompt3DObjectRules = spec.objectRules ?? { type: "auto", component: "whole" };
  const field = "mt-1 w-full rounded border border-line bg-bg p-2 text-fg";
  return <section aria-label="Object-specific generation rules" className="space-y-3 rounded-lg border border-gold/30 bg-bg p-3 text-xs">
    <h3 className="font-semibold text-gold">Object & component rules</h3>
    <div className="grid grid-cols-2 gap-3">
      <label>Object type<select aria-label="Object type" className={field} value={choice.type} onChange={e => onChange({ type: e.target.value as Prompt3DObjectType, component: "whole", shapeNotes: choice.shapeNotes })}>
        {OBJECT_TYPES.map(type => <option key={type} value={type}>{type === "auto" ? `Auto · ${rule.profile.label}` : OBJECT_PROFILES[type].label}</option>)}
      </select></label>
      <label>Component<select aria-label="Object component" className={field} value={rule.component} onChange={e => onChange({ ...choice, type: rule.type, component: e.target.value as Prompt3DComponent, anchor: undefined, flipVertical: false })}>
        {rule.profile.parts.map(part => <option key={part} value={part}>{COMPONENT_LABELS[part]}</option>)}
      </select></label>
    </div>
    <p>{rule.orientation}. <b>{rule.anchorLabel} at Y=0.</b></p>
    <p className="text-muted">One object and one view; white background and even lighting. Your original description stays saved for surface refinement. Camera, background and ornamental prose are not appended to the geometry prompt.</p>
    <label className="block">Additional shape details<textarea aria-label="Additional shape details" className={`${field} min-h-16`} maxLength={320} placeholder="Shape only: e.g. broad crescent cutting edges, short thick handle" value={choice.shapeNotes ?? ""} onChange={e => onChange({ ...choice, shapeNotes: e.target.value })}/></label>
    <details><summary className="cursor-pointer text-gold">Attachment point and orientation correction</summary>
      <p className="my-2 text-muted">The selected point becomes (0,0,0) in the exported mesh. These are fractions of the model bounds, not automatic grip recognition. Adjust after inspecting the concept. A centred attachment leaves some geometry below Y=0.</p>
      <div className="grid grid-cols-3 gap-2">{(["x", "y", "z"] as const).map(axis => <label key={axis}>{axis.toUpperCase()} position (%)<input aria-label={`Attachment ${axis.toUpperCase()} percent`} className={field} type="number" min={0} max={100} step={1} value={Math.round(rule.anchor[axis] * 100)} onChange={e => onChange({ ...choice, anchor: { ...rule.anchor, [axis]: Math.min(100, Math.max(0, Number(e.target.value))) / 100 } })}/></label>)}</div>
      <p className="mt-1 text-muted">Y: 0 = bottom, 100 = top. X: left → right. Z: back → front.</p>
      <label className="mt-2 block"><input type="checkbox" checked={choice.flipVertical ?? false} onChange={e => onChange({ ...choice, flipVertical: e.target.checked })}/> Flip the generated mesh upside down before placing its origin</label>
      <button type="button" className="mt-2 underline" onClick={() => onChange({ ...choice, anchor: undefined, flipVertical: false })}>Reset to component defaults</button>
    </details>
    <details open><summary className="cursor-pointer text-gold">Actual geometry prompt</summary>{plan ? <><p data-testid="compiled-geometry-prompt" className="mt-2 whitespace-pre-wrap rounded border border-line p-2">{plan.generationPrompt}</p>
      {plan.removedPresentation.length > 0 && <p className="mt-2 text-amber-200">Presentation instructions excluded: {plan.removedPresentation.join("; ")}</p>}</> : <p role="alert" data-testid="compiled-geometry-prompt-error" className="mt-2 rounded border border-red-400/40 bg-red-500/10 p-2 text-red-200">This brief is too detailed for the local Hunyuan prompt budget. Shorten the description or move optional details into a later shape-refinement prompt. {promptError}</p>}
    </details>
    <p className="text-muted">{plan ? <>Review: {plan.review} </> : null}The model can still ignore these instructions; technical validation does not prove shape or attachment accuracy.</p>
  </section>;
}
