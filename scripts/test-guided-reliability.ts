import assert from "node:assert/strict";
import { createServer } from "node:http";
import { prompt3DSettingsError, parsePrompt3DOptionalNumber, prompt3DFinishSettingsError } from "../src/shared/prompt3dInputValidation";
import { promptedMotionCapabilityError } from "../src/shared/promptedMotionIntent";
import { compilePromptedAnimation } from "../src/main/prompt3d/promptedAnimation";
import { probeEndpoint as appProbe, TRUTH_PROBE_TIMEOUT_MS } from "../src/shared/fleet";
import { probeEndpoint as cliProbe } from "../cli/src/lib/fleet";
import type { AssetSpecV1 } from "../src/shared/prompt3d";

async function main(): Promise<void> {
const spec = { seed: 42, dimensions: { width: 1, height: 1, depth: 1, unit: "m" }, budgets: { maxTriangles: 50_000, maxTextureResolution: 2048, maxTextureBytes: 32 * 1024 ** 2 }, style: "stylized", providerId: "hunyuan3d-2", category: "prop" } as AssetSpecV1;
assert.equal(prompt3DSettingsError(spec), null);
for (const seed of [-1, 1.5, NaN, Infinity, 2147483648]) assert.match(prompt3DSettingsError({ ...spec, seed })!, /Seed/);
for (const width of [0, -1, NaN, Infinity, 10001]) assert.match(prompt3DSettingsError({ ...spec, dimensions: { ...spec.dimensions, width } })!, /Width/);
assert.match(prompt3DSettingsError({ ...spec, style: "custom" })!, /custom style/);
assert.equal(prompt3DSettingsError({ ...spec, style: "custom", customStyle: "engraved bronze" }), null);
assert.equal(parsePrompt3DOptionalNumber("", "Seed"), undefined);
assert.equal(parsePrompt3DOptionalNumber("0", "Seed"), 0);
for (const value of ["abc", "1.5", "-1", "Infinity", "2147483648"]) assert.throws(() => parsePrompt3DOptionalNumber(value, "Seed"));
for (const value of ["abc", "0", "6", "NaN"]) assert.match(prompt3DFinishSettingsError("", value)!, /Duration/);
assert.equal(prompt3DFinishSettingsError("42", "2.5"), null);
for (const prompt of ["Spin centrally, then spread out and fold back into place", "Rotate while melting", "Shatter and spin", "Spin in place. Do not travel but unfold the petals.", "Do not travel; instead unfold the petals.", "Avoid travel, however unfold the petals."]) {
  assert.match(promptedMotionCapabilityError(prompt)!, /cannot/);
  assert.throws(() => compilePromptedAnimation(prompt), /cannot/);
}
assert.equal(promptedMotionCapabilityError("Spin in place. Do not unfold or shatter."), null);
assert.equal(promptedMotionCapabilityError("Spin in place but do not unfold the petals."), null);
assert.equal(promptedMotionCapabilityError("Spin in place. Do not yet unfold the petals."), null);
for (const prompt of ["Spin slowly. Do not yet move forward.", "Walk naturally without yet moving forward."]) {
  assert.equal(compilePromptedAnimation(prompt).rootPath, "stationary", "temporal yet must not end negation");
}
assert.equal(compilePromptedAnimation("Spin centrally in place").rootPath, "stationary");
assert.equal(compilePromptedAnimation("Swim along a figure-eight path").rootPath, "figure-eight");

// Real local HTTP failures exercise fetch and response cleanup, not a mirrored mock implementation.
const server = createServer((req, res) => {
  if (req.url === "/hang") return;
  if (req.url === "/html") { res.writeHead(200, { "content-type": "TEXT/HTML; charset=utf-8" }); res.end("<html>fallback</html>"); return; }
  res.writeHead(req.url === "/auth" ? 401 : 200, { "content-type": "application/json" });
  res.end('{"ok":true}');
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
try {
  await Promise.all([appProbe, cliProbe].map(async (probe) => {
    assert.equal((await probe({ id: "health", label: "Health", role: "game-data", url: `${base}/json` })).ok, true);
    assert.equal((await probe({ id: "health", label: "Health", role: "game-data", url: `${base}/html` })).ok, false);
    assert.equal((await probe({ id: "asset", label: "Asset", role: "assets", url: `${base}/html` })).ok, false);
    assert.equal((await probe({ id: "forge", label: "Forge", role: "forge", url: `${base}/html` })).ok, true);
    assert.equal((await probe({ id: "auth-me", label: "Auth", role: "identity", url: `${base}/auth` })).ok, true);
    const started = Date.now();
    assert.equal((await probe({ id: "hang", label: "Unavailable", role: "game-data", url: `${base}/hang` })).ok, false);
    assert.ok(Date.now() - started < TRUTH_PROBE_TIMEOUT_MS + 2500, "probe must abort at its deadline");
  }));
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
console.log("Guided validation, unsupported-motion and real HTTP timeout/fallback checks passed.");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
