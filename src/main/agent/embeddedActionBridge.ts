import { AppNativeInput } from "./appNativeInput";
import { appDialogs } from "./appDialogs";
import { BrowserWindow, webContents, type WebContents } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EMBEDDED_SURFACES, embeddedUrlAllowed, embeddedPlacementCount, embeddedSelectedObject, type EmbeddedObserveRequest, type EmbeddedObservation, type EmbeddedExecuteRequest } from "../../shared/embeddedActions";
import { validateAppActionRequest, validateAppActionDecision, type AppActionSnapshot } from "../../shared/appActions";

interface Retained { owner: number; guest: number; surface: EmbeddedObserveRequest["surface"]; at: number; documentId: string; url: string; raw: AppActionSnapshot; snapshot: AppActionSnapshot }
const WORLD = 998;
export class EmbeddedActionBridge {
  private retained = new Map<string, Retained>();
  private bundle?: Promise<string>;
  readonly native = new AppNativeInput();
  constructor(private localCoderUrl: () => string | null = () => null, private appWindowAllowed: (contents: WebContents) => boolean = () => false) {}
  windows(owner: WebContents) { return BrowserWindow.getAllWindows().filter(w => w.webContents !== owner && !w.isDestroyed() && this.appWindowAllowed(w.webContents)).map(w => ({ id: w.webContents.id, title: w.getTitle().slice(0, 160) || "App window" })); }
  private config(surface: EmbeddedObserveRequest["surface"], contents: WebContents) { return surface === "app" ? { route: "/", name: "App" } : surface === "window" ? { route: "/app-window", name: `Window ${contents.getTitle()}` } : EMBEDDED_SURFACES[surface]; }
  private guest(owner: WebContents, request: EmbeddedObserveRequest): WebContents {
    if (!request || !Number.isSafeInteger(request.webContentsId) || !Object.hasOwn(EMBEDDED_SURFACES, request.surface) && !["app", "window"].includes(request.surface)) throw new Error("Invalid embedded tool request.");
    const guest = request.surface === "app" ? owner : webContents.fromId(request.webContentsId);
    if (request.surface === "app" || request.surface === "window") {
      if (!guest || guest.isDestroyed() || request.surface === "window" && !this.appWindowAllowed(guest)) throw new Error("This is not an owned app window.");
      return guest;
    }
    if (!guest || guest.isDestroyed() || guest.hostWebContents !== owner || guest.getType() !== "webview") throw new Error("This embedded tool does not belong to the requesting app window.");
    if (guest.isLoadingMainFrame() || !guest.getURL() || guest.getURL() === "about:blank" && request.surface !== "preview") throw new Error("APP_CONTROLS_CHANGED: The embedded tool is loading. Wait for its controls.");
    if (!embeddedUrlAllowed(request.surface, guest.getURL(), this.localCoderUrl())) throw new Error("This page is outside the embedded tool's supported origins. Open its normal app page first.");
    return guest;
  }
  private async run(guest: WebContents, method: "observe" | "execute", input?: unknown) {
    this.bundle ??= readFile(join(__dirname, "../../embedded/appActionGuest.js"), "utf8");
    const bundle = await this.bundle;
    const code = `if (!globalThis.__grudgeEmbeddedActions) { ${bundle}\n globalThis.__grudgeEmbeddedActions = GrudgeEmbeddedGuest; }\nglobalThis.__grudgeEmbeddedActions.${method}(${input === undefined ? "" : JSON.stringify(input)});`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([guest.executeJavaScriptInIsolatedWorld(WORLD, [{ code }], method === "execute"), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("The embedded tool did not respond. Review it before retrying.")), 10_000); })]);
    } finally { clearTimeout(timer); }
  }
  async observe(owner: WebContents, request: EmbeddedObserveRequest): Promise<EmbeddedObservation> {
    const guest = this.guest(owner, request), url = guest.getURL();
    await this.native.watch(guest);
    const result = await this.run(guest, "observe");
    if (guest.isDestroyed() || guest.getURL() !== url || result.url !== url) throw new Error("The embedded tool navigated during observation. Try again.");
    validateAppActionRequest({ prompt: "Observe embedded controls", snapshot: result.snapshot, history: [] });
    const config = this.config(request.surface, guest);
    const snapshot: AppActionSnapshot = { route: config.route, controls: result.snapshot.controls.map((c: AppActionSnapshot["controls"][number]) => ({ ...c, id: request.surface === "app" ? c.id : `${request.surface === "window" ? "window" : "embedded"}-${guest.id}-${c.id}`, context: request.surface === "app" ? c.context : `${request.surface === "window" ? "" : "Embedded "}${config.name}${c.context ? ` · ${c.context}` : ""}`.slice(0, 220) })), status: request.surface === "app" ? result.snapshot.status : [`${config.name}: ${new URL(url).origin}${new URL(url).pathname}`.slice(0, 600), ...result.snapshot.status.map((s: string) => `${request.surface === "window" ? "" : "Embedded "}${config.name}: ${s}`.slice(0, 600))].slice(0, 30) };
    for (const [token, old] of this.retained) if (old.guest === guest.id || Date.now() - old.at > 120_000) this.retained.delete(token);
    const token = randomUUID();
    this.retained.set(token, { owner: owner.id, guest: guest.id, surface: request.surface, at: Date.now(), documentId: result.documentId, url, raw: result.snapshot, snapshot });
    return { token, documentId: result.documentId, snapshot };
  }
  async execute(owner: WebContents, input: EmbeddedExecuteRequest): Promise<string> {
    const retained = input && this.retained.get(input.token);
    if (!retained || retained.owner !== owner.id || Date.now() - retained.at > 120_000) throw new Error("APP_CONTROLS_CHANGED: The embedded observation expired. Check its controls again.");
    this.retained.delete(input.token); // Each observed action can be applied at most once.
    const guest = this.guest(owner, { surface: retained.surface, webContentsId: retained.guest });
    const request = validateAppActionRequest({ prompt: input.prompt, snapshot: retained.snapshot, history: [] });
    const decision = validateAppActionDecision(input.decision, request);
    if (["done", "blocked", "wait"].includes(decision.action)) throw new Error("Only an observed embedded control may be changed.");
    const index = retained.snapshot.controls.findIndex(c => c.id === decision.target);
    const control = retained.raw.controls[index];
    const destination = decision.action === "drag" ? retained.raw.controls[retained.snapshot.controls.findIndex(c => c.id === decision.value)] : undefined;
    let dialogTimer: ReturnType<typeof setInterval> | undefined;
    const operation = this.run(guest, "execute", { documentId: retained.documentId, url: retained.url, deadline: Date.now() + 9_000, control, destination, decision: { ...decision, target: control.id, value: destination?.id ?? decision.value } });
    const result = await Promise.race([operation, new Promise<any>(resolve => { dialogTimer = setInterval(() => { if (appDialogs.observe(owner)) resolve({ ok: true, value: `Activated ${control.label}; app dialog opened` }); }, 50); })]).finally(() => clearInterval(dialogTimer));
    if (!result.ok) throw new Error(`${result.changed ? "APP_CONTROLS_CHANGED: " : ""}${result.error}`);
    if (["keys", "type", "pointer", "files"].includes(decision.action)) return this.native.execute(guest, decision as import("../../shared/appActions").AppActionDecision, result.value);
    return `${result.value}${retained.surface === "app" ? "" : ` in ${this.config(retained.surface, guest).name}`}${decision.action === "drag" ? ` [Before placement count: ${embeddedPlacementCount(retained.raw.status, control.label)}] [Before selection: ${JSON.stringify(embeddedSelectedObject(retained.raw.status))}]` : ""}`;
  }
}
