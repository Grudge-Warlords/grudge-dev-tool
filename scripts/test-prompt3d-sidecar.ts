import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

async function main() {
  const root = resolve(process.env.GRUDGE_PROMPT3D_ROOT || "E:\\GrudgePrompt3D");
  const python = resolve(root, ".python", "cpython-3.10-windows-x86_64-none", "python.exe");
  assert.ok(existsSync(python), "isolated Prompt-to-3D Python runtime is required for the sidecar contract check");
  const temp = await mkdtemp(join(root, ".sidecar-contract-"));
  const rel = relative(root, temp);
  assert.ok(rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "test directory must remain inside the generator root");
  const token = randomBytes(32).toString("base64url");
  const sidecar = resolve(__dirname, "..", "tools", "prompt3d", "sidecar.py");
  const worker = resolve(__dirname, "fixtures", "prompt3d-cancel-worker.py");
  const child = spawn(python, [sidecar, "--port", "0", "--root", root, "--worker", worker], {
    windowsHide: true,
    shell: false,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      GRUDGE_PROMPT3D_SIDECAR_TOKEN: token,
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await new Promise<number>((resolvePromise, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error("sidecar startup timed out")), 10_000);
      child.stdout.on("data", (value) => {
        buffer += String(value);
        const line = buffer.split(/\r?\n/)[0];
        try { const parsed = JSON.parse(line); clearTimeout(timer); resolvePromise(parsed.port); } catch { /* await a full line */ }
      });
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`sidecar exited during startup: ${code}`)));
    });
    const request = async (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    assert.equal((await request("/health")).status, 200, "sidecar health must be available only through its authenticated loopback surface");
    const rejected = await request("/jobs", { method: "POST", body: JSON.stringify({ jobId: `${randomUUID()}-1`, providerId: "not-allowlisted", specPath: join(temp, "spec.json"), output: join(temp, "output.glb") }) });
    assert.equal(rejected.status, 400, "an unallowlisted provider must fail before a worker starts");
    await writeFile(join(temp, "spec.json"), "{}\n");
    const jobId = `${randomUUID()}-1`;
    const started = await request("/jobs", { method: "POST", body: JSON.stringify({ jobId, providerId: "hunyuan3d-2", specPath: join(temp, "spec.json"), output: join(temp, "output.glb"), python }) });
    assert.equal(started.status, 202, "typed fixture job should start");
    for (let attempt = 0; attempt < 30 && !existsSync(join(temp, ".provider-worker.pid")); attempt += 1) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    assert.ok(existsSync(join(temp, ".provider-worker.pid")), "task-owned fixture PID marker should exist before cancellation");
    const cancelled = await request(`/jobs/${jobId}/cancel`, { method: "POST", body: "{}" });
    assert.equal(cancelled.status, 200, "typed cancellation request should be accepted");
    let status: any = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      status = await (await request(`/jobs/${jobId}`)).json();
      if (status.state === "cancelled" && /Cancellation completed/.test(status.message)) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    assert.equal(status?.state, "cancelled", `cancelled worker state was overwritten: ${JSON.stringify(status)}`);
    assert.match(status?.message ?? "", /Cancellation completed/, "sidecar must report completed task-owned cancellation");
    process.stdout.write("Prompt-to-3D sidecar health, rejection and cancellation checks passed.\n");
  } finally {
    child.kill();
    if (child.exitCode === null) await Promise.race([
      new Promise((resolvePromise) => child.once("exit", resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
    ]);
    await rm(temp, { recursive: true, force: true });
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
