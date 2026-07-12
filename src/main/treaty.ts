/**
 * Treaty API client (main process) — friends, DMs, groups on Grudge ID.
 * Uses Studio SSO session JWT against the fleet game API.
 */
import { net } from "electron";
import { FLEET_CLIENT_URL, FLEET_URLS } from "../shared/fleet";
import * as studioSso from "./auth/studioSso";
import log from "./logger";

const TREATY_BASES = [
  process.env.GRUDGE_TREATY_API?.replace(/\/$/, ""),
  FLEET_CLIENT_URL.replace(/\/$/, ""),
  FLEET_URLS.gameData.replace(/\/$/, ""),
].filter(Boolean) as string[];

function jsonRequest(
  method: string,
  url: string,
  body?: unknown,
  bearer?: string | null,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null;
    const req = net.request({ method, url });
    req.setHeader("Accept", "application/json");
    if (payload) req.setHeader("Content-Type", "application/json");
    if (bearer) req.setHeader("Authorization", `Bearer ${bearer}`);
    req.setHeader("Origin", "https://grudge-studio.com");

    const chunks: Buffer[] = [];
    req.on("response", (res) => {
      res.on("data", (c) => chunks.push(Buffer.from(c)));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = { raw: raw.slice(0, 300) };
        }
        resolve({ status: res.statusCode ?? 0, data });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getBearer(): Promise<string> {
  const bundle = await studioSso.getModuleAuthBundle();
  const token = bundle.grudgeSessionToken || (await import("./auth/puterSession").then((m) => m.getPuterToken()));
  if (!token) throw new Error("Not signed in — open Settings or sign in to use Treaty");
  return token;
}

async function treatyFetch(path: string, init?: { method?: string; body?: unknown }): Promise<any> {
  const bearer = await getBearer();
  const method = init?.method ?? "GET";
  const rel = path.startsWith("/") ? path : `/${path}`;
  let lastErr = "Treaty request failed";

  for (const base of TREATY_BASES) {
    const url = `${base}/api/treaty${rel}`;
    try {
      const { status, data } = await jsonRequest(method, url, init?.body, bearer);
      if (status >= 200 && status < 300) return data;
      if (status === 401 || status === 403) {
        // Refresh SSO once and retry this base
        await studioSso.syncStudioSso();
        const retryBearer = await getBearer();
        const retry = await jsonRequest(method, url, init?.body, retryBearer);
        if (retry.status >= 200 && retry.status < 300) return retry.data;
        lastErr = retry.data?.error || `HTTP ${retry.status}`;
        continue;
      }
      if (status === 404) {
        lastErr = `HTTP 404 at ${base}`;
        continue;
      }
      lastErr = data?.error || `HTTP ${status}`;
    } catch (err: any) {
      lastErr = err?.message ?? String(err);
      log.warn(`[treaty] ${method} ${url} failed:`, lastErr);
    }
  }
  throw new Error(lastErr);
}

export const treaty = {
  social: () => treatyFetch("/social"),
  friendRequest: (query: string) =>
    treatyFetch("/friends/request", { method: "POST", body: { query } }),
  friendRespond: (id: string, accept: boolean) =>
    treatyFetch(`/friends/${id}/respond`, { method: "POST", body: { accept } }),
  dmThreads: () => treatyFetch("/dm/threads"),
  openDm: (friendAccountId: string) =>
    treatyFetch("/dm/threads", { method: "POST", body: { friendAccountId } }),
  dmMessages: (threadId: string) => treatyFetch(`/dm/threads/${threadId}/messages`),
  sendDm: (threadId: string, content: string) =>
    treatyFetch(`/dm/threads/${threadId}/messages`, { method: "POST", body: { content } }),
  groups: () => treatyFetch("/groups"),
  createGroup: (name: string, description?: string, members?: string[]) =>
    treatyFetch("/groups", { method: "POST", body: { name, description, members } }),
  groupDetail: (groupId: string) => treatyFetch(`/groups/${groupId}`),
  inviteGroup: (groupId: string, query: string) =>
    treatyFetch(`/groups/${groupId}/invite`, { method: "POST", body: { query } }),
  leaveGroup: (groupId: string) =>
    treatyFetch(`/groups/${groupId}/leave`, { method: "POST", body: {} }),
  groupMessages: (groupId: string) => treatyFetch(`/groups/${groupId}/messages`),
  sendGroup: (groupId: string, content: string) =>
    treatyFetch(`/groups/${groupId}/messages`, { method: "POST", body: { content } }),
  unread: () => treatyFetch("/unread"),
  whoami: async () => {
    const bundle = await studioSso.getModuleAuthBundle();
    return {
      player: bundle.player,
      hasToken: !!bundle.grudgeSessionToken,
      puterUser: bundle.puterUser,
    };
  },
};
