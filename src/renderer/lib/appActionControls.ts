import { appActionStatusText, appControlValueMatches, type AppActionDecision, type AppActionSnapshot, type AppControl } from "../../shared/appActions";

const ids = new WeakMap<Element, string>();
let sequence = 0;
let checkOcclusion = false;
export function setAppControlOcclusionCheck(enabled: boolean): void { checkOcclusion = enabled; }
const compact = (text: string | null | undefined, max = 220) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const excluded = (el: Element) => Boolean(el.closest('[data-grudge-command], [data-app-action-private], [inert], [aria-hidden="true"]'));
function visiblePoint(el: HTMLElement): { x: number; y: number } | null {
  const bounds = el.getBoundingClientRect();
  const left = Math.max(1, bounds.left), right = Math.min(innerWidth - 1, bounds.right), top = Math.max(1, bounds.top), bottom = Math.min(innerHeight - 1, bounds.bottom);
  if (right <= left || bottom <= top) return null;
  for (const fy of [0.5, 0.25, 0.75, 0.1, 0.9]) for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
    const x = left + (right - left) * fx, y = top + (bottom - top) * fy, hit = document.elementFromPoint(x, y);
    if (hit && el.contains(hit)) return { x, y };
  }
  return null;
}
function displayed(el: HTMLElement): boolean {
  if (excluded(el) || !el.isConnected || !el.getClientRects().length) return false;
  // Chromium can retain layout rectangles for closed <details> descendants.
  // Only its direct summary is an available control until it is opened.
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement && !parent.open) {
      const summary = [...parent.children].find(child => child.tagName === "SUMMARY");
      if (!summary?.contains(el)) return false;
    }
  }
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (checkOcclusion) {
    const modal = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].find(dialog => dialog.getClientRects().length && getComputedStyle(dialog).visibility !== "hidden");
    if (modal && !modal.contains(el)) return false;
    const bounds = el.getBoundingClientRect();
    // A catalog item clipped by its own scroll pane remains reachable through
    // normal scrolling. Do not mistake that clipping for a covering dialog.
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), clip = parent.getBoundingClientRect();
      if (/auto|scroll/.test(css.overflowY) && parent.scrollHeight > parent.clientHeight && (bounds.top < clip.top || bounds.bottom > clip.bottom)) return true;
      if (/auto|scroll/.test(css.overflowX) && parent.scrollWidth > parent.clientWidth && (bounds.left < clip.left || bounds.right > clip.right)) return true;
    }
    if (bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight) {
      if (!visiblePoint(el)) return false;
    }
  }
  return true;
}
function label(el: HTMLElement): string {
  const input = el as HTMLInputElement;
  const labelText = input.labels?.length ? [...input.labels].map(l => {
    const copy = l.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("input,textarea,select,button,svg,option").forEach(child => child.remove());
    return copy.textContent;
  }).join(" ") : "";
  const labelledBy = (el.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ").trim();
  return compact(el.getAttribute("aria-label") || labelledBy || el.getAttribute("title") ||
    labelText ||
    el.getAttribute("placeholder") || (el instanceof HTMLInputElement ? el.name : el.textContent));
}
function describe(el: HTMLElement): AppControl | null {
  if (!displayed(el)) return null;
  if (el instanceof HTMLInputElement && ["password", "hidden", "file"].includes(el.type)) return null;
  if (/password|secret|token|api.?key|credential/i.test(`${el.getAttribute("name")} ${el.getAttribute("aria-label")} ${el.getAttribute("autocomplete")}`)) return null;
  const name = label(el);
  if (!name) return null;
  if (/password|secret|token|api.?key|credential/i.test(name)) return null;
  if (!ids.has(el)) ids.set(el, `control-${++sequence}`);
  const select = el instanceof HTMLSelectElement, input = el instanceof HTMLInputElement;
  const ariaToggle = ["switch", "checkbox", "radio", "menuitemcheckbox", "menuitemradio"].includes(el.getAttribute("role") || "");
  const kind: AppControl["kind"] = el.hasAttribute("data-app-action-drag") ? "drag" : el.hasAttribute("data-app-action-drop") ? "drop" : select ? "select" : ariaToggle || input && ["checkbox", "radio"].includes(el.type) ? "toggle" : el.isContentEditable || el instanceof HTMLTextAreaElement || input && !["button", "submit", "reset"].includes(el.type) ? "text" : "click";
  const section = el.closest("section,fieldset,aside,[role=dialog]");
  const selection = el.closest("main") ? [...document.querySelectorAll<HTMLElement>('[aria-pressed="true"][aria-label^="Select object"],[aria-pressed="true"][aria-label^="Select node"]')].filter(n => !excluded(n)).map(n => n.getAttribute("aria-label")).join("; ") : "";
  const context = compact([section?.querySelector("legend,h1,h2,h3,h4,b")?.textContent || (el.closest("aside") ? "Navigation" : ""), selection, el.closest("[data-app-action-context]")?.getAttribute("data-app-action-context")].filter(Boolean).join(" · "));
  const disabled = el.matches(":disabled") || el.getAttribute("aria-disabled") === "true" || Boolean(el.closest('[aria-busy="true"]')) || (kind === "text" && Boolean((el as HTMLInputElement).readOnly));
  return { id: ids.get(el)!, label: name, kind, context, disabled,
    ...(input ? { inputType: el.type } : {}),
    ...(kind === "text" || kind === "select" ? { value: (el.isContentEditable ? el.innerText : (el as HTMLInputElement).value).slice(0, 2200) } : kind === "toggle" ? { value: ariaToggle ? el.getAttribute("aria-checked") ?? "false" : String((el as HTMLInputElement).checked) } : el.hasAttribute("aria-pressed") ? { value: el.getAttribute("aria-pressed")! } : el.hasAttribute("aria-selected") ? { value: el.getAttribute("aria-selected")! } : el.hasAttribute("aria-expanded") ? { value: el.getAttribute("aria-expanded")! } : el.closest("nav") ? { value: String(el.getAttribute("aria-current") === "page") } : el.tagName === "SUMMARY" ? { value: String((el.parentElement as HTMLDetailsElement).open) } : {}),
    ...(select ? { options: [...el.options].filter(o => !o.disabled).slice(0, 100).map(o => ({ value: o.value.slice(0, 500), label: compact(o.label) })) } : {}),
  };
}
export function captureAppControls(route: string): { snapshot: AppActionSnapshot; elements: Map<string, HTMLElement> } {
  const elements = new Map<string, HTMLElement>(), controls: AppControl[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('button,input,textarea,select,summary,a[href],[role="button"],[role="tab"],[role="menuitem"],[role="treeitem"],[role="option"],[role="switch"],[role="checkbox"],[role="radio"],[role="menuitemcheckbox"],[role="menuitemradio"],[contenteditable="true"][role="textbox"],[data-app-action-drag],[data-app-action-drop]')) {
    const c = describe(el); if (!c) continue;
    if (controls.length >= 300) break;
    controls.push(c); elements.set(c.id, el);
  }
  const status = [...document.querySelectorAll<HTMLElement>('[role="status"],[role="alert"],[aria-live="polite"],[aria-live="assertive"],[data-app-action-state],h1,h2')]
    .filter(displayed).map(el => appActionStatusText(el.getAttribute("data-app-action-state"), el.innerText)).filter(Boolean).slice(0, 30);
  if (document.querySelector('[data-app-action-busy="true"]')) status.unshift("An app action is running. Wait for its result; do not start it again.");
  return { snapshot: { route, controls, status: status.slice(0, 30) }, elements };
}

export class AppControlsChangedError extends Error {}

/** The original element must still represent the observed control when planning returns. */
export function executeAppControl(decision: AppActionDecision, observed: ReturnType<typeof captureAppControls>): string {
  let element = observed.elements.get(decision.target);
  const previous = observed.snapshot.controls.find(c => c.id === decision.target);
  const identity = (c: AppControl) => JSON.stringify({ ...c, id: "" });
  if (previous && !element?.isConnected) {
    // React may remount a toolbar during a frame/update. Resolve only a single
    // semantically identical control, including value, options and selection.
    const fresh = captureAppControls(observed.snapshot.route);
    const matches = fresh.snapshot.controls.filter(c => identity(c) === identity(previous));
    if (matches.length === 1) element = fresh.elements.get(matches[0].id);
  }
  const current = element && describe(element);
  if (!element || !previous || !current || current.disabled || identity(current) !== identity(previous)) throw new AppControlsChangedError(`The ${previous?.label ?? "requested"} control changed while Grudge was planning.`);
  if (decision.action === "drag") {
    const destination = observed.elements.get(decision.value), expected = observed.snapshot.controls.find(c => c.id === decision.value);
    const described = destination && describe(destination);
    if (!destination || !expected || !described || described.disabled || described.kind !== "drop" || current.kind !== "drag" || identity(described) !== identity(expected)) throw new AppControlsChangedError("The drag destination changed during planning.");
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    destination.scrollIntoView({ block: "nearest", inline: "nearest" });
    const point = visiblePoint(destination);
    if (!point) throw new Error("The scene drop area is covered. Close its overlay before placing an object.");
    const { x, y } = point;
    const dataTransfer = new DataTransfer();
    element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    destination.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y }));
    destination.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y }));
    destination.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y }));
    element.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
    return `Dragged ${current.label} to ${described.label}`;
  }
  if (decision.action === "set" && element instanceof HTMLInputElement && !["checkbox", "radio"].includes(element.type)) {
    const probe = element.cloneNode() as HTMLInputElement;
    probe.value = decision.value;
    if (!appControlValueMatches({ ...current, value: probe.value }, decision.value) || !probe.checkValidity()) throw new Error(`The requested value is not valid for ${current.label}. No value was changed.`);
  }
  if (decision.action === "set" && element.isContentEditable && / {2,}|\t/.test(decision.value) && !/^(?:pre|break-spaces)/.test(getComputedStyle(element).whiteSpace)) throw new Error(`The ${current.label} editor collapses whitespace and cannot retain the exact requested text. No text was changed.`);
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (decision.action === "click") element.click();
  else if (decision.action === "set") {
    if (current.kind === "toggle") {
      if (current.value !== decision.value) element.click();
    } else if (element.isContentEditable) {
      element.focus();
      const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(element); selection?.removeAllRanges(); selection?.addRange(range);
      // Use Chromium's plain-text editing operation so spaces, line breaks,
      // undo and the editor's existing input handler retain normal semantics.
      if (!document.execCommand("insertText", false, decision.value)) throw new Error(`The ${current.label} editor does not support plain-text input.`);
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, decision.value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } else throw new Error("This decision is not a control action.");
  return `${decision.action === "click" ? "Activated" : "Set"} ${current.label}${decision.action === "set" ? `: ${decision.value.slice(0, 160)}` : ""}`;
}
