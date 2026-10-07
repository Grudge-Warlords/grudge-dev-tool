import { EMBEDDED_SURFACES, type EmbeddedSurface, type EmbeddedObservation } from "../../shared/embeddedActions";
import type { AppActionDecision } from "../../shared/appActions";
import { AppControlsChangedError } from "./appActionControls";
import { appControlWindow } from "../components/AppControlWindow";

interface ActionWebview extends HTMLElement { getWebContentsId(): number }
export async function captureAppSurfaces(route: string) {
  // All input uses one isolated observation and its retained document identity.
  if (await window.grudge.appNative.dialog()) for (let i = 0; i < 20 && !document.querySelector('[data-app-action-context="App dialog"]'); i++) await new Promise(resolve => setTimeout(resolve, 50));
  const local: EmbeddedObservation = await window.grudge.embeddedActions.observe({ surface: "app", webContentsId: 0 });
  let embedded: EmbeddedObservation | undefined;
  let element: HTMLElement | undefined;
  const modal = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
  if (!modal && appControlWindow.current) {
    embedded = await window.grudge.embeddedActions.observe({ surface: "window", webContentsId: appControlWindow.current });
    element = document.body;
  } else if (!modal) {
    const webview = [...document.querySelectorAll<ActionWebview>("webview[data-app-action-embedded]")].find(el => el.isConnected && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
    if (webview) {
      const surface = webview.getAttribute("data-app-action-embedded") as EmbeddedSurface;
      if (EMBEDDED_SURFACES[surface]?.route === route) {
        element = webview;
        try { embedded = await window.grudge.embeddedActions.observe({ surface, webContentsId: webview.getWebContentsId() }); }
        catch (error) { local.snapshot.status.unshift(`Embedded tool unavailable: ${error instanceof Error ? error.message : String(error)}`.slice(0, 600)); }
      }
    }
  }
  const localControls = !modal && appControlWindow.current ? local.snapshot.controls.filter(c => c.context === "App windows") : embedded ? local.snapshot.controls.slice(0, 120) : local.snapshot.controls;
  return { local, embedded, element, snapshot: {
    route, controls: [...localControls, ...(embedded?.snapshot.controls ?? [])].slice(0, 300),
    status: [...await window.grudge.appNative.status(), ...(embedded?.snapshot.status.slice(0, 15) ?? []), ...local.snapshot.status].slice(0, 30),
  } };
}
export async function executeAppSurface(decision: AppActionDecision, observed: Awaited<ReturnType<typeof captureAppSurfaces>>, prompt: string) {
  const remote = /^(?:embedded|window)-/.test(decision.target);
  const observation = remote ? observed.embedded : observed.local;
  if (!observation || remote && !observed.element?.isConnected) throw new AppControlsChangedError("The app window closed during planning.");
  try { return await window.grudge.embeddedActions.execute({ token: observation.token, prompt, decision }); }
  catch (error) { if (String(error).includes("APP_CONTROLS_CHANGED:")) throw new AppControlsChangedError("The app updated while Grudge was planning."); throw error; }
}
