import type { OrchestratorPlanStep } from "./grudaHub";

export async function executeOrchestratorStep(step: OrchestratorPlanStep): Promise<{
  ok: boolean;
  output: string;
}> {
  const dev = window.grudge.dev;

  try {
    switch (step.worker) {
      case "npm": {
        if (step.command?.startsWith("npm run ")) {
          const script = step.command.slice("npm run ".length);
          const r = await dev.npmRun(script);
          return { ok: r.ok, output: [r.stdout, r.stderr].filter(Boolean).join("\n") };
        }
        const r = await dev.terminal(step.command ?? "npm install");
        return { ok: r.ok, output: [r.stdout, r.stderr].filter(Boolean).join("\n") };
      }
      case "terminal": {
        if (!step.command) return { ok: true, output: "Terminal step ready — run a command in the Terminal tab." };
        const r = await dev.terminal(step.command);
        return { ok: r.ok, output: [r.stdout, r.stderr].filter(Boolean).join("\n") };
      }
      case "vscode": {
        const r = await dev.openVsCode();
        return { ok: r.ok, output: r.ok ? "Opened workspace in VS Code / Cursor" : (r.error ?? "Failed") };
      }
      case "webgl":
      case "forge": {
        await window.grudge.app.openRoute("/forge");
        return { ok: true, output: "Opened Forge 3D WebGL viewport" };
      }
      case "coder": {
        const st = await window.grudge.coder.status();
        if (!st.running) await window.grudge.coder.launch({});
        await window.grudge.coder.open();
        return { ok: true, output: "GrudgeChain Coder IDE launched" };
      }
      case "node": {
        if (!step.command) return { ok: true, output: "Node step — specify script path in plan command." };
        const r = await dev.spawnNode(step.command);
        return { ok: r.ok, output: r.ok ? `Spawned node PID ${r.pid}` : (r.error ?? "Failed") };
      }
      case "pod": {
        const local = await dev.listPods();
        return { ok: true, output: JSON.stringify(local, null, 2) };
      }
      case "legion": {
        const chat = await window.grudge.legion.chat({ message: step.detail, role: "dev" });
        return { ok: true, output: chat.response ?? JSON.stringify(chat) };
      }
      default:
        return { ok: false, output: `Unknown worker: ${step.worker}` };
    }
  } catch (e: unknown) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) };
  }
}