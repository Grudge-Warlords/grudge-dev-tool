import { FLEET_URLS } from "../../shared/fleet";

/** Semantic adapters for existing production controls. No remote internals,
 * model-generated code or alternate editor implementation is invoked. */
export function prepareEmbeddedControls(): string[] {
  if (location.origin !== FLEET_URLS.threeflow) return [];
  const clean = (value: string | null) => (value || "").replace(/[\ue000-\uf8ff]/g, "").replace(/\s+/g, " ").trim();
  const palette = document.querySelector<HTMLElement>(".tf-palette");
  if (palette) {
    palette.setAttribute("role", "dialog"); palette.setAttribute("aria-modal", "true");
    if (!palette.querySelector('[data-grudge-close-palette],[aria-label="Close command palette"]')) {
      const close = document.createElement("button");
      close.type = "button"; close.textContent = "Close"; close.setAttribute("aria-label", "Close command palette"); close.setAttribute("data-grudge-close-palette", "true");
      close.style.cssText = "position:absolute;right:20px;top:12px;padding:6px 12px;background:#252938;color:white;border:1px solid #777;cursor:pointer;z-index:1";
      close.addEventListener("click", event => { event.stopPropagation(); palette.click(); });
      palette.append(close);
    }
  }
  for (const tab of document.querySelectorAll<HTMLElement>(".left-drag-content .tab-item[title]")) {
    const name = clean(tab.lastElementChild?.textContent ?? tab.textContent);
    if (!name) continue;
    tab.setAttribute("role", "tab"); tab.setAttribute("aria-label", name);
    tab.setAttribute("aria-selected", String(tab.classList.contains("is-active")));
  }
  for (const item of document.querySelectorAll<HTMLElement>('.left-drag-content .drag-item[draggable="true"]')) {
    const name = clean(item.querySelector(":scope > div")?.textContent ?? item.textContent);
    if (!name) continue;
    item.setAttribute("data-app-action-drag", "true"); item.setAttribute("aria-label", name);
  }
  const viewport = document.getElementById("scene-render");
  if (viewport) { viewport.setAttribute("data-app-action-drop", "true"); viewport.setAttribute("aria-label", "Scene viewport"); }
  for (const node of document.querySelectorAll<HTMLElement>('.scene-content-tree [role="treeitem"]')) {
    const content = node.querySelector<HTMLElement>(":scope > .el-tree-node__content");
    if (content && /^Camera(?:\s|$)/.test(clean(content.innerText))) node.setAttribute("aria-label", "Select Camera");
  }
  const selection = document.querySelector<HTMLElement>("[data-app-action-selected-object]") ?? document.querySelector<HTMLElement>(".tf-status > span:nth-of-type(3)");
  for (const panel of document.querySelectorAll<HTMLElement>(".property-content")) {
    // These labels and axis captions are already visible in the production
    // property panel, but Element Plus does not associate them with its inputs.
    if (selection) panel.setAttribute("data-app-action-context", `Selected object: ${clean(selection.innerText)}`);
    else panel.removeAttribute("data-app-action-context");
    for (const row of panel.querySelectorAll<HTMLElement>(".property-item")) {
      const name = clean(row.querySelector(":scope > .property-item-label")?.textContent ?? "");
      if (!name) continue;
      const inputs = [...row.querySelectorAll<HTMLElement>('input:not([type="hidden"]),[role="switch"]')].filter(el => !el.closest('[role="switch"]') || el.getAttribute("role") === "switch");
      for (const input of inputs) {
        if (input.getAttribute("role") === "combobox") continue;
        const axis = clean(input.closest(".input-content")?.querySelector(":scope > span")?.textContent ?? "");
        if (/^[XYZ]$/.test(axis)) input.setAttribute("aria-label", `${name} ${axis}`);
        else if (inputs.length === 1) input.setAttribute("aria-label", name);
      }
    }
  }
  const names = [...document.querySelectorAll<HTMLElement>(".scene-content-tree .el-tree-node__content")].filter(el => el.getClientRects().length).map(el => clean(el.innerText)).filter(Boolean);
  return [...(palette ? ["Command palette open"] : []), ...(selection?.getClientRects().length ? [`Selected object: ${clean(selection.innerText)}`.slice(0, 600)] : []), ...(names.length ? [`Scene hierarchy: ${names.join("; ")}`.slice(0, 600)] : [])];
}
