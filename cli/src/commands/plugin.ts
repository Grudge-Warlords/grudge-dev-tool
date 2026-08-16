import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_ORIGIN = process.env.GRUDGE_PLUGIN_ORIGIN || "http://127.0.0.1:17380";

function discoverToken(): string {
  if (process.env.GRUDGE_PLUGIN_TOKEN) return process.env.GRUDGE_PLUGIN_TOKEN;
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  const candidates = [
    join(appData, "grudge-dev-tool", "plugin-token"),
    join(appData, "Grudge Dev Tool", "plugin-token"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const t = readFileSync(p, "utf8").trim();
      if (t) return t;
    }
  }
  return "";
}

async function pluginFetch(path: string, body?: unknown): Promise<unknown> {
  const token = discoverToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${DEFAULT_ORIGIN.replace(/\/+$/, "")}${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* raw */
  }
  if (!res.ok) {
    const err = typeof data === "object" && data && "error" in data
      ? String((data as { error: string }).error)
      : `${res.status} ${text.slice(0, 200)}`;
    throw new Error(err);
  }
  return data;
}

export async function runPlugin(opts: {
  action: string;
  task?: string;
  path?: string;
  json?: boolean;
}): Promise<number> {
  try {
    let out: unknown;
    switch (opts.action) {
      case "status":
        out = await pluginFetch("/health");
        break;
      case "practices":
        out = await pluginFetch("/v1/practices");
        break;
      case "chat":
      case "run":
        if (!opts.task) {
          console.error("plugin chat requires --task");
          return 1;
        }
        out = await pluginFetch("/v1/agent/run", { task: opts.task, role: "dev" });
        break;
      case "viewer":
        if (!opts.path) {
          console.error("plugin viewer requires --path");
          return 1;
        }
        out = /^(https?:)/i.test(opts.path)
          ? await pluginFetch("/v1/viewer/open", { url: opts.path })
          : await pluginFetch("/v1/viewer/open", { localPath: opts.path });
        break;
      default:
        console.error("plugin action: status | practices | chat | viewer");
        return 1;
    }
    if (opts.json || opts.action === "status" || opts.action === "practices") {
      console.log(JSON.stringify(out, null, 2));
    } else if (opts.action === "chat" || opts.action === "run") {
      const r = out as { response?: string; source?: string };
      console.log(r.response || JSON.stringify(out, null, 2));
      if (r.source) console.error(`— ${r.source}`);
    } else {
      console.log(JSON.stringify(out, null, 2));
    }
    return 0;
  } catch (e) {
    console.error(
      `plugin attach failed (${DEFAULT_ORIGIN}). Is Grudge Dev Tool running?\n${e instanceof Error ? e.message : e}`,
    );
    return 1;
  }
}
