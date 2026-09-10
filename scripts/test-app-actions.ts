import { appCreationPrompt } from "../src/shared/appCreationPrompt";
import assert from "node:assert/strict";
import { appLocalPathRequest, validateAppLocalPath } from "../src/shared/appLocalPath";
import { literalAppSettings, requestedAppSettingNames } from "../src/shared/appActionSettings";
import { embeddedPlacementConfirmed } from "../src/shared/embeddedActions";
import { injectSessionIntoWebview } from "../src/renderer/lib/webviewSession";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appActionStatusText, appControlValueMatches, validateAppActionDecision, validateAppActionRequest, type AppActionRequest } from "../src/shared/appActions";
import { applyCreationEdit, creationEditContext, creationSceneHash } from "../src/main/prompt3d/creationEdits";
import { bindRequestedActions, validateCreationPromptPlan } from "../src/main/prompt3d/creationPrompt";
import { creationIO } from "../src/main/prompt3d/proceduralCreation";
import { submitCreation, reopenCreation, saveCreationToLibrary } from "../src/main/prompt3d/creationService";

async function main() {
  const handoff = { token: null, grudgeId: "test", username: "test", email: null, puterUuid: null, signedIn: true };
  const sessionGuest = { getAttribute: () => "forge", getURL: () => "https://forge.grudge-studio.com/editor", addEventListener() {}, removeEventListener() {}, executeJavaScript: async () => false };
  assert.equal(await injectSessionIntoWebview(sessionGuest, handoff), false, "A page navigation that rejects session handoff cannot be reported as successful");
  assert.equal(await injectSessionIntoWebview({ ...sessionGuest, executeJavaScript: async () => true }, handoff), true);
  const boxStatus = ["Embedded ThreeFlow: Scene hierarchy: Camera", "Embedded ThreeFlow: Selected object: BoxGeometry"];
  const dragReceipt = 'Dragged Box to Scene viewport in embedded ThreeFlow [Before placement count: 0] [Before selection: "nothing selected"]';
  assert(embeddedPlacementConfirmed(boxStatus, "Box", dragReceipt), "The live selected-object HUD can confirm a new object while the hierarchy is stale");
  assert(!embeddedPlacementConfirmed(boxStatus, "Box"), "Observed selection alone cannot establish a completed creation");
  assert(!embeddedPlacementConfirmed(boxStatus, "Box", dragReceipt.replace("Dragged", "Activated")));
  assert(!embeddedPlacementConfirmed(boxStatus, "Box", dragReceipt.replace("nothing selected", "BoxGeometry")), "An unchanged existing selection is not a new object");
  assert(!embeddedPlacementConfirmed(boxStatus, "Sphere", dragReceipt));
  assert(!embeddedPlacementConfirmed(boxStatus, "Box", dragReceipt.replace('"nothing selected"', "null")));
  assert(!embeddedPlacementConfirmed(boxStatus, "Box", dragReceipt.replace("nothing selected", "bad\\z")), "Malformed receipt data fails closed");
  assert.equal(appActionStatusText("true", "Grudge planning is off"), "Grudge planning is off", "React boolean markers must keep the real visible planner state");
  assert.equal(appActionStatusText("Opened folder E:\\Models  and scenes", "unused"), "Opened folder E:\\Models  and scenes", "Explicit result paths retain significant spaces");
  assert.deepEqual(appLocalPathRequest('Open folder "E:\\Models  and scenes".'), { kind: "folder", path: "E:\\Models  and scenes" });
  assert.deepEqual(appLocalPathRequest('Open model "E:\\Models\\green cube.glb" in Forge.'), { kind: "model", path: "E:\\Models\\green cube.glb" });
  assert.equal(appLocalPathRequest('Do not open folder "E:\\Models"'), null);
  assert.equal(appLocalPathRequest('Open model "E:\\Models\\cube.glb"'), null, "Forge handoff needs explicit Forge intent");
  assert.equal(appLocalPathRequest('Open Local Files'), null);
  for (const path of ['https://example.com/model.glb', '\\\\server\\share', 'E:\\model.glb:secret', 'E:\\model\n.glb']) assert.throws(() => validateAppLocalPath(path), /local drive path/);
  const request: AppActionRequest = { prompt: "Open Local Files", snapshot: { route: "/studio", status: [], controls: [{ id: "control-1", label: "Local Files", kind: "click", disabled: false, context: "Navigation" }] }, history: [] };
  validateAppActionRequest(request);
  const numeric = { ...request.snapshot.controls[0], kind: "text" as const, inputType: "number", value: "1" };
  assert(appControlValueMatches(numeric, "1.0"), "React numeric formatting must not fail a correct setting");
  assert(!appControlValueMatches(numeric, "2"));
  assert(!appControlValueMatches({ ...numeric, value: "0" }, ""));
  assert(!appControlValueMatches({ ...numeric, inputType: "text" }, "1.0"), "Text values must still match exactly");
  const decision = { action: "click", target: "control-1", value: "", reason: "Open the requested page" };
  assert.deepEqual(requestedAppSettingNames('Set Name to "Coverage Box" and Position X to 3.'), ["Name", "Position X"]);
  const hiddenFields: AppActionRequest = { prompt: 'In ThreeFlow, set Name to "Coverage Box" and Position X to 3.', history: [{ action: "click control-1", result: "Opened editor" }], snapshot: { route: "/threeflow", status: [], controls: [{ id: "embedded-1-control-1", label: "Filter hierarchy…", kind: "text", disabled: false, context: "Embedded ThreeFlow", value: "" }, { id: "embedded-1-control-2", label: "increase number", kind: "click", disabled: false, context: "Embedded ThreeFlow" }] } };
  assert.throws(() => validateAppActionDecision({ ...decision, action: "set", target: "embedded-1-control-1", value: "3" }, hiddenFields), /Only the named fields/);
  assert.throws(() => validateAppActionDecision({ ...decision, target: "embedded-1-control-2" }, hiddenFields), /named fields or open a closed panel/);
  assert.throws(() => validateAppActionDecision({ ...decision, action: "done", target: "" }, hiddenFields), /fields and values/);
  const multi: AppActionRequest = { prompt: "Set Exposure to 1.2 and Key light intensity to 0.8.", history: [{ action: "set control-1 1.2", result: "Set Exposure: 1.2" }], snapshot: { route: "/forge-local", status: [], controls: [{ ...numeric, label: "Exposure", inputType: "range", value: "1.2" }, { ...numeric, id: "control-2", label: "Key light intensity", inputType: "range", value: "1" }] } };
  assert.equal(literalAppSettings(multi.prompt, multi.snapshot.controls)?.length, 2);
  assert.throws(() => validateAppActionDecision({ ...decision, action: "done", target: "" }, multi), /Some requested settings/);
  multi.snapshot.controls[1].value = "0.8";
  validateAppActionDecision({ ...decision, action: "done", target: "" }, multi);
  const textControl = { ...numeric, label: "Notes", inputType: "text", value: "" };
  assert.equal(literalAppSettings('Set Notes to "green  and blue\nsecond line".', [textControl])?.[0].value, "green  and blue\nsecond line");
  assert.equal(literalAppSettings("Set Exposure to 1.2 and delete the asset", multi.snapshot.controls), null, "An unknown clause cannot be dropped");
  assert.equal(validateAppActionDecision(decision, request).target, "control-1");
  assert.throws(() => validateAppActionDecision({ ...decision, target: "invented" }, request), /unavailable/);
  assert.throws(() => validateAppActionDecision({ ...decision, action: "done", target: "" }, request), /No app action/);
  for (const label of ["Publish", "Install update", "Approve for 3D", "Delete everything", "Quit"]) assert.throws(() => validateAppActionDecision(decision, { ...request, snapshot: { ...request.snapshot, controls: [{ ...request.snapshot.controls[0], label }] } }), /explicit request/);
  assert.throws(() => validateAppActionDecision(decision, { ...request, prompt: "Do not publish anything", snapshot: { ...request.snapshot, controls: [{ ...request.snapshot.controls[0], label: "Publish" }] } }), /explicit request/);
  const toggle = { ...request, snapshot: { ...request.snapshot, controls: [{ ...request.snapshot.controls[0], kind: "toggle" as const, value: "false" }] } };
  assert.throws(() => validateAppActionDecision(decision, toggle), /explicit value/);
  validateAppActionDecision({ ...decision, action: "set", value: "true" }, toggle);
  const baseRequest = { prompt: "Fixture assembly", category: "prop" as const, style: "low-poly" as const, usePlanner: false };
  const root = await mkdtemp(join(tmpdir(), "grudge-actions-"));
  const created = await submitCreation(root, baseRequest, { kind: "assembly", operation: "create", summary: "Fixture", planner: "test fixture", constraints: [], components: [
    { name: "Seat", shape: "box", color: "#996633", position: [0, 1, 0], size: [2, .2, 1] },
    { name: "Backrest", shape: "box", color: "#996633", position: [0, 1.5, -.5], size: [2, 1, .2] },
  ] });
  assert.equal(created.state, "complete", created.message);
  const io = await creationIO(), original = await io.read(created.assetPath!);
  const originalHash = creationSceneHash(original);
  const before = creationEditContext(original);
  applyCreationEdit(original, { action: "duplicate", targets: ["Seat"] });
  let parts = creationEditContext(original).parts;
  assert.equal(parts.filter(p => p.mesh).length, 3);
  assert.deepEqual(parts.find(p => p.name === "Seat copy")?.position, [2, 1, 0]);
  assert.deepEqual(parts.find(p => p.name === "Seat")?.position, before.parts.find(p => p.name === "Seat")?.position);
  applyCreationEdit(original, { action: "rename", targets: ["Seat copy"], name: "Spare seat" });
  applyCreationEdit(original, { action: "color", targets: ["Spare seat"], color: "#0000ff" });
  const meshes = original.getRoot().listNodes().filter((n: any) => n.getMesh());
  assert.deepEqual(meshes.find((n: any) => n.getName() === "Spare seat").getMesh().listPrimitives()[0].getMaterial().getBaseColorFactor(), [0, 0, 1, 1]);
  assert.notDeepEqual(meshes.find((n: any) => n.getName() === "Seat").getMesh().listPrimitives()[0].getMaterial().getBaseColorFactor(), [0, 0, 1, 1]);
  assert.throws(() => applyCreationEdit(original, { action: "rename", targets: ["Spare seat"], name: "Seat" }), /already exists/);
  assert.throws(() => applyCreationEdit(original, { action: "remove", targets: ["Seat", "Spare seat", "Backrest"] }), /empty asset/);
  applyCreationEdit(original, { action: "remove", targets: ["Spare seat"] });
  assert.equal(creationEditContext(original).parts.filter(p => p.mesh).length, 2);
  assert.equal(creationSceneHash(await io.read(created.assetPath!)), originalHash, "Immutable original must be unchanged");
  for (const interpolation of ["LINEAR", "CUBICSPLINE"] as const) {
    const animated = await io.read(created.assetPath!);
    const seat = animated.getRoot().listNodes().find((n: any) => n.getName() === "Seat")!;
    const buffer = animated.getRoot().listBuffers()[0];
    const keys = interpolation === "LINEAR" ? [0, 1, 0, 1, 2, 0] : [0, 0, 0, 0, 1, 0, .2, 0, 0, .2, 0, 0, 1, 2, 0, 0, 0, 0];
    const input = animated.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(buffer);
    const output = animated.createAccessor().setType("VEC3").setArray(new Float32Array(keys)).setBuffer(buffer);
    const sampler = animated.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(interpolation);
    const channel = animated.createAnimationChannel().setTargetNode(seat).setTargetPath("translation").setSampler(sampler);
    const animation = animated.createAnimation("Seat motion").addChannel(channel);
    const unchanged = Array.from(output.getArray()!);
    applyCreationEdit(animated, { action: "duplicate", targets: ["Seat"] });
    const copied = animation.listChannels().find((c: any) => c.getTargetNode()?.getName() === "Seat copy")!;
    const expected = [...unchanged];
    for (let i = interpolation === "CUBICSPLINE" ? 3 : 0; i < expected.length; i += interpolation === "CUBICSPLINE" ? 9 : 3) expected[i] += 2;
    assert.deepEqual(Array.from(copied.getSampler()!.getOutput()!.getArray()!), expected, "Copied motion must retain its offset without changing tangents");
    assert.deepEqual(Array.from(output.getArray()!), unchanged, "Copying must preserve original motion keys");
  }
  const beforeAdd = creationEditContext(original).parts;
  applyCreationEdit(original, { action: "add", targets: ["$asset"], parts: [{ name: "Beacon", shape: "sphere", size: [1, 1, 1], position: [3, .5, 0], color: "#ff0000" }] });
  assert.equal(creationEditContext(original).parts.filter(p => p.mesh).length, 3);
  for (const p of beforeAdd) assert.deepEqual(creationEditContext(original).parts.find(n => n.name === p.name), p, "Adding components preserves existing transforms");
  assert.throws(() => applyCreationEdit(original, { action: "add", targets: ["$asset"], parts: [{ name: "Beacon", shape: "sphere", size: [1, 1, 1], position: [3, .5, 0], color: "#0000ff" }] }), /already exists/);
  applyCreationEdit(original, { action: "remove", targets: ["Beacon"] });
  const proposal = { kind: "assembly", summary: "Edit components", unsupported: [], components: [], steps: [
    { operation: "edit", instruction: "Duplicate Seat", edit: { action: "duplicate", targets: ["Seat"] } },
    { operation: "edit", instruction: "Rename Seat copy to Cushion", edit: { action: "rename", targets: ["Seat copy"], name: "Wrong name" } },
    { operation: "save", instruction: "Save" },
  ] };
  const plan = validateCreationPromptPlan(await bindRequestedActions(proposal, { ...baseRequest, prompt: "Duplicate Seat, then rename Seat copy to Cushion and save it" }, "assembly", before), "assembly");
  assert.equal(plan.steps[1].edit?.name, "Cushion");
  assert.deepEqual(plan.steps[1].edit?.targets, ["Seat copy"], "An existing name prefix must not replace a newly created part target");
  const renamedNew = validateCreationPromptPlan(await bindRequestedActions({ ...proposal, steps: [{ operation: "edit", instruction: "Rename Seat to New Seat", edit: { action: "rename", targets: ["Seat"], name: "New Seat" } }] }, { ...baseRequest, prompt: "Rename Seat to New Seat" }, "assembly", before), "assembly");
  assert.deepEqual(renamedNew.steps.map(s => s.operation), ["edit"], "New in a part name cannot create a replacement asset");
  let current = created;
  for (const step of plan.steps.filter(s => s.operation !== "save")) {
    current = await submitCreation(root, { ...baseRequest, prompt: step.instruction, parentId: current.id }, { kind: "assembly", operation: "edit", edit: step.edit, planner: "test fixture", constraints: [], summary: "Edit" });
    assert.equal(current.state, "complete", current.message);
  }
  const saved = await saveCreationToLibrary(root, current.id);
  assert.equal((await reopenCreation(root, current.id)).sha256, saved.asset.sha256);
  console.log("App control validation and immutable duplicate/rename/remove/save checks passed.");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

assert.deepEqual(appCreationPrompt("Create a blue cube, make it spin, save it, then open it in Forge."), { creation: "Create a blue cube, make it spin, save it", continuation: "Open the current model in Forge." });
assert.deepEqual(appCreationPrompt("Create a chest with an open lid"), { creation: "Create a chest with an open lid", continuation: "" });
const neuralRequest: AppActionRequest = { prompt: "Create a cube without Hunyuan", snapshot: { route: "/prompt3d", controls: [{ id: "control-123", kind: "click", label: "Generate Hunyuan concept", context: "Optional neural generation", disabled: false }], status: [] }, history: [] };
assert.throws(() => validateAppActionDecision({ action: "click", target: "control-123", value: "", reason: "Start enhancement" }, neuralRequest), /explicit provider request/);
validateAppActionDecision({ action: "click", target: "control-123", value: "", reason: "Start requested enhancement" }, { ...neuralRequest, prompt: "Create a cube with Hunyuan" });
const handoffReceipt: AppActionRequest = { prompt: "Create a cube and open it in Forge", snapshot: { route: "/forge-local", controls: [], status: ["Loaded model from local saved revision"] }, history: [
  { action: "set control-1 Create a cube", result: "Set Creation prompt: Create a cube" },
  { action: "click control-2 ", result: "Activated Run prompt. Saved revision: exact local model." },
  { action: "click control-3 ", result: "Activated Edit in Forge." },
] };
validateAppActionDecision({ action: "done", target: "", value: "", reason: "Saved and opened in Forge" }, handoffReceipt);
assert.throws(() => validateAppActionDecision({ action: "done", target: "", value: "", reason: "Opened in Forge" }, { ...handoffReceipt, history: handoffReceipt.history.map(h => ({ ...h, result: h.result.replace("Saved revision: exact local model.", "Still working.") })) }), /has not produced a saved revision/);
const neuralOverride: AppActionRequest = { ...neuralRequest, snapshot: { ...neuralRequest.snapshot, controls: [{ id: "control-123", kind: "select", label: "Route override", context: "Advanced route planner", disabled: false, options: [{ value: "hunyuan3d-2", label: "Hunyuan" }] }] } };
assert.throws(() => validateAppActionDecision({ action: "set", target: "control-123", value: "hunyuan3d-2", reason: "Choose provider" }, neuralOverride), /explicit provider request/);
