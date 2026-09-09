import { EMBEDDED_SURFACES, type EmbeddedSurface, type EmbeddedObservation } from "../../shared/embeddedActions";
import type { AppActionDecision } from "../../shared/appActions";
import { AppControlsChangedError, captureAppControls, executeAppControl } from "./appActionControls";

interface ActionWebview extends HTMLElement { getWebContentsId(): number }
export async function captureAppSurfaces(route: string) {
  const local = captureAppControls(route);
  let embedded: EmbeddedObservation | undefined;
  const element = [...document.querySelectorAll<ActionWebview>("webview[data-app-action-embedded]")].find(el => el.isConnected && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
  if (element) {
    const surface = element.getAttribute("data-app-action-embedded") as EmbeddedSurface;
    if (EMBEDDED_SURFACES[surface]?.route === route) {
      try {
        embedded = await window.grudge.embeddedActions.observe({ surface, webContentsId: element.getWebContentsId() });
      } catch (error) {
        local.snapshot.status.unshift(`Embedded tool unavailable: ${error instanceof Error ? error.message : String(error)}`.slice(0, 600));
      }
    }
  }
  const localControls = embedded ? local.snapshot.controls.slice(0, 120) : local.snapshot.controls;
  return { local, embedded, element, snapshot: {
    route, controls: [...localControls, ...(embedded?.snapshot.controls ?? [])].slice(0, 300),
    status: [...(embedded?.snapshot.status.slice(0, 15) ?? []), ...local.snapshot.status].slice(0, 30),
  } };
}
export async function executeAppSurface(decision: AppActionDecision, observed: Awaited<ReturnType<typeof captureAppSurfaces>>, prompt: string) {
  if (!decision.target.startsWith("embedded-")) return executeAppControl(decision, observed.local);
  if (!observed.embedded || !observed.element?.isConnected) throw new AppControlsChangedError("The embedded tool closed during planning.");
  try { return await window.grudge.embeddedActions.execute({ token: observed.embedded.token, prompt, decision }); }
  catch (error) {
    if (String(error).includes("APP_CONTROLS_CHANGED:")) throw new AppControlsChangedError("The embedded tool updated while Grudge was planning.");
    throw error;
  }
}
