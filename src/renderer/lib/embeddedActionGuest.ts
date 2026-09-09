// Bundled separately and installed only in an isolated world of an owned guest.
// Remote page scripts cannot replace this state or supply executable code.
import { captureAppControls, executeAppControl, AppControlsChangedError, setAppControlOcclusionCheck } from "./appActionControls";
import type { AppActionDecision, AppControl } from "../../shared/appActions";
import { prepareEmbeddedControls } from "./embeddedActionAdapters";

const documentId = crypto.randomUUID();
setAppControlOcclusionCheck(true);
export function observe() {
  const status = prepareEmbeddedControls();
  const snapshot = captureAppControls("/").snapshot;
  snapshot.status = [...status, ...snapshot.status].slice(0, 30);
  return { documentId, url: location.href, snapshot };
}
export function execute(input: { documentId: string; url: string; deadline: number; control: AppControl; destination?: AppControl; decision: AppActionDecision }) {
  try {
    if (input.documentId !== documentId || input.url !== location.href || Date.now() > input.deadline) throw new AppControlsChangedError("The embedded page changed or the action expired while Grudge was planning.");
    prepareEmbeddedControls();
    const observed = captureAppControls("/");
    observed.snapshot.controls = [input.control, ...(input.destination ? [input.destination] : [])];
    return { ok: true, value: executeAppControl(input.decision, observed) };
  } catch (error) {
    return { ok: false, changed: error instanceof AppControlsChangedError, error: error instanceof Error ? error.message : String(error) };
  }
}
