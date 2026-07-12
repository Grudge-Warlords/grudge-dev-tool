/**
 * Treaty — full friends / DMs / groups social UI for Grudge Studio.
 * Backed by fleet /api/treaty/* using the Studio SSO session.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MessageCircle, Users, UserPlus, Send, ArrowLeft, Check, X, Plus, LogOut,
  Loader2, RefreshCw, Shield,
} from "lucide-react";

type SubTab = "friends" | "dms" | "groups";

interface Friend {
  id: string;
  status: string;
  accountId: string;
  grudgeId: string | null;
  displayName: string | null;
  isIncoming?: boolean;
}

interface DmThread {
  threadId: string;
  otherAccountId: string;
  grudgeId: string | null;
  displayName: string;
  lastMessage: string | null;
  lastMessageAt: number;
  unread: number;
}

interface Message {
  id: string;
  threadId?: string;
  groupId?: string;
  senderAccountId: string;
  content: string;
  createdAt: number;
  senderDisplayName?: string | null;
}

interface Group {
  groupId: string;
  name: string;
  description: string | null;
  ownerAccountId: string;
  role: string;
  memberCount: number;
  lastMessage: string | null;
  lastMessageAt: number;
  unread: number;
}

function label(f: { displayName?: string | null; grudgeId?: string | null; name?: string }) {
  return f.displayName || f.name || f.grudgeId || "Warlord";
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const treaty = {
  whoami: () => window.grudge.treaty.whoami() as Promise<any>,
  social: () => window.grudge.treaty.social() as Promise<{ friends: Friend[]; pendingIncoming: Friend[]; pendingOutgoing: Friend[] }>,
  friendRequest: (query: string) => window.grudge.treaty.friendRequest(query),
  friendRespond: (id: string, accept: boolean) => window.grudge.treaty.friendRespond(id, accept),
  dmThreads: () => window.grudge.treaty.dmThreads() as Promise<{ threads: DmThread[] }>,
  openDm: (friendAccountId: string) => window.grudge.treaty.openDm(friendAccountId) as Promise<{ thread: { id: string } }>,
  dmMessages: (id: string) => window.grudge.treaty.dmMessages(id) as Promise<{ messages: Message[] }>,
  sendDm: (id: string, content: string) => window.grudge.treaty.sendDm(id, content),
  groups: () => window.grudge.treaty.groups() as Promise<{ groups: Group[] }>,
  createGroup: (name: string, description?: string, members?: string[]) =>
    window.grudge.treaty.createGroup(name, description, members),
  inviteGroup: (id: string, query: string) => window.grudge.treaty.inviteGroup(id, query),
  leaveGroup: (id: string) => window.grudge.treaty.leaveGroup(id),
  groupMessages: (id: string) => window.grudge.treaty.groupMessages(id) as Promise<{ messages: Message[] }>,
  sendGroup: (id: string, content: string) => window.grudge.treaty.sendGroup(id, content),
  unread: () => window.grudge.treaty.unread() as Promise<{ unread: number }>,
};

export default function TreatyPage() {
  const [subTab, setSubTab] = useState<SubTab>("dms");
  const [who, setWho] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<Friend[]>([]);
  const [outgoing, setOutgoing] = useState<Friend[]>([]);
  const [threads, setThreads] = useState<DmThread[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [groupMessages, setGroupMessages] = useState<Message[]>([]);

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [unread, setUnread] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  const loadSocial = useCallback(async () => {
    const s = await treaty.social();
    setFriends(s.friends || []);
    setIncoming(s.pendingIncoming || []);
    setOutgoing(s.pendingOutgoing || []);
  }, []);

  const loadThreads = useCallback(async () => {
    const t = await treaty.dmThreads();
    setThreads(t.threads || []);
  }, []);

  const loadGroups = useCallback(async () => {
    const g = await treaty.groups();
    setGroups(g.groups || []);
  }, []);

  const refreshAll = useCallback(async () => {
    setError(null);
    try {
      // Ensure Studio SSO JWT is fresh before Treaty calls (covers cold open of tab)
      try {
        await window.grudge?.auth?.syncStudioSso?.();
      } catch { /* non-fatal; whoami will surface auth errors */ }

      let w = await treaty.whoami();
      if (!w?.hasToken && !w?.player) {
        // One more SSO pass if Puter session exists but Grudge JWT was empty
        try {
          await window.grudge?.auth?.syncStudioSso?.();
          w = await treaty.whoami();
        } catch { /* */ }
      }
      setWho(w);
      if (!w?.hasToken && !w?.player) {
        setError("Sign in to Grudge Studio to use Treaty");
        setLoading(false);
        return;
      }
      await Promise.all([loadSocial(), loadThreads(), loadGroups()]);
      try {
        const u = await treaty.unread();
        setUnread(u.unread || 0);
      } catch { /* optional */ }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [loadSocial, loadThreads, loadGroups]);

  useEffect(() => {
    void refreshAll();
    const t = setInterval(() => {
      void refreshAll().catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [refreshAll]);

  useEffect(() => {
    if (!activeThreadId) return;
    let cancelled = false;
    (async () => {
      try {
        const m = await treaty.dmMessages(activeThreadId);
        if (!cancelled) setMessages(m.messages || []);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || "Failed to load messages");
      }
    })();
    const t = setInterval(async () => {
      try {
        const m = await treaty.dmMessages(activeThreadId);
        if (!cancelled) setMessages(m.messages || []);
      } catch { /* */ }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeGroupId) return;
    let cancelled = false;
    (async () => {
      try {
        const m = await treaty.groupMessages(activeGroupId);
        if (!cancelled) setGroupMessages(m.messages || []);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || "Failed to load group messages");
      }
    })();
    const t = setInterval(async () => {
      try {
        const m = await treaty.groupMessages(activeGroupId);
        if (!cancelled) setGroupMessages(m.messages || []);
      } catch { /* */ }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [activeGroupId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, groupMessages]);

  const startDm = async (friendAccountId: string) => {
    try {
      const { thread } = await treaty.openDm(friendAccountId);
      setActiveGroupId(null);
      setActiveThreadId(thread.id);
      setSubTab("dms");
      await loadThreads();
    } catch (e: any) {
      toast.error(e?.message || "Could not open DM");
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (activeThreadId) {
        await treaty.sendDm(activeThreadId, text);
        setDraft("");
        const m = await treaty.dmMessages(activeThreadId);
        setMessages(m.messages || []);
        await loadThreads();
      } else if (activeGroupId) {
        await treaty.sendGroup(activeGroupId, text);
        setDraft("");
        const m = await treaty.groupMessages(activeGroupId);
        setGroupMessages(m.messages || []);
        await loadGroups();
      }
    } catch (e: any) {
      toast.error(e?.message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  const addFriend = async () => {
    const q = addQuery.trim();
    if (!q) return;
    setAdding(true);
    try {
      await treaty.friendRequest(q);
      toast.success("Friend request sent");
      setAddQuery("");
      await loadSocial();
    } catch (e: any) {
      toast.error(e?.message || "Request failed");
    } finally {
      setAdding(false);
    }
  };

  const respond = async (id: string, accept: boolean) => {
    try {
      await treaty.friendRespond(id, accept);
      toast.success(accept ? "Friend added" : "Request declined");
      await loadSocial();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
  };

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    setCreatingGroup(true);
    try {
      const r = await treaty.createGroup(name);
      toast.success(`Group "${name}" created`);
      setNewGroupName("");
      await loadGroups();
      if (r?.group?.id) {
        setActiveThreadId(null);
        setActiveGroupId(r.group.id);
        setSubTab("groups");
      }
    } catch (e: any) {
      toast.error(e?.message || "Create group failed");
    } finally {
      setCreatingGroup(false);
    }
  };

  const invite = async () => {
    if (!activeGroupId || !inviteQuery.trim()) return;
    try {
      await treaty.inviteGroup(activeGroupId, inviteQuery.trim());
      toast.success("Invite sent");
      setInviteQuery("");
    } catch (e: any) {
      toast.error(e?.message || "Invite failed");
    }
  };

  const leave = async () => {
    if (!activeGroupId) return;
    if (!confirm("Leave this group?")) return;
    try {
      await treaty.leaveGroup(activeGroupId);
      setActiveGroupId(null);
      await loadGroups();
      toast.success("Left group");
    } catch (e: any) {
      toast.error(e?.message || "Leave failed");
    }
  };

  const activeThread = threads.find((t) => t.threadId === activeThreadId);
  const activeGroup = groups.find((g) => g.groupId === activeGroupId);
  const inChat = !!(activeThreadId || activeGroupId);
  const chatMessages = activeThreadId ? messages : groupMessages;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted">
        <Loader2 size={18} className="animate-spin text-gold" />
        Loading Treaty…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="shrink-0 px-1 pb-3 border-b border-line mb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="page-title flex items-center gap-2 mb-0">
              <MessageCircle size={20} className="text-gold" />
              Treaty
            </h1>
            <p className="page-sub mt-1 mb-0">
              Friends, DMs &amp; groups on your Grudge ID — same social SSOT as Warlords / wallet
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gold/20 text-gold border border-gold/40">
                {unread} unread
              </span>
            )}
            <button type="button" className="btn ghost text-xs flex items-center gap-1" onClick={() => void refreshAll()}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-2 text-[10px]">
          <span className={`px-2 py-0.5 rounded border ${who?.player || who?.hasToken ? "border-emerald-500/40 text-emerald-400" : "border-line text-muted"}`}>
            {who?.player || who?.hasToken ? "Signed in" : "Sign in required"}
          </span>
          {who?.player?.grudgeId && (
            <span className="px-2 py-0.5 rounded border border-gold/30 text-gold font-mono">{who.player.grudgeId}</span>
          )}
          {who?.player?.username && (
            <span className="px-2 py-0.5 rounded border border-line text-muted">{who.player.username}</span>
          )}
        </div>
      </header>

      {error && (
        <div className="card status-bad text-sm mb-3 flex items-start gap-2">
          <Shield size={16} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Treaty unavailable</div>
            <div className="text-xs opacity-90 mt-0.5">{error}</div>
            <div className="text-[10px] mt-2 opacity-70">Sign in via Studio login (Puter / Grudge ID), then refresh.</div>
          </div>
        </div>
      )}

      {!error && (
        <div className="flex-1 min-h-0 flex flex-col card !p-0 overflow-hidden">
          {!inChat && (
            <div className="flex border-b border-line shrink-0">
              {([
                { id: "dms" as const, label: "DMs", Icon: MessageCircle },
                { id: "friends" as const, label: "Friends", Icon: Users },
                { id: "groups" as const, label: "Groups", Icon: Users },
              ]).map(({ id, label: lab, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs border-b-2 transition-colors ${
                    subTab === id ? "border-gold text-gold" : "border-transparent text-muted hover:text-ink"
                  }`}
                  onClick={() => setSubTab(id)}
                >
                  <Icon size={13} /> {lab}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-auto p-3">
            {/* ── Friends ── */}
            {subTab === "friends" && !inChat && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    className="flex-1 text-xs"
                    placeholder="Grudge ID or username…"
                    value={addQuery}
                    onChange={(e) => setAddQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void addFriend()}
                  />
                  <button className="btn text-xs flex items-center gap-1" disabled={adding} onClick={() => void addFriend()}>
                    <UserPlus size={12} /> {adding ? "…" : "Add"}
                  </button>
                </div>

                {incoming.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Incoming</div>
                    {incoming.map((f) => (
                      <div key={f.id} className="flex items-center justify-between py-1.5 border-b border-line/50">
                        <span className="text-xs">{label(f)}</span>
                        <div className="flex gap-1">
                          <button className="btn ghost text-[10px] px-2" onClick={() => void respond(f.id, true)}>
                            <Check size={11} />
                          </button>
                          <button className="btn ghost danger text-[10px] px-2" onClick={() => void respond(f.id, false)}>
                            <X size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {outgoing.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Outgoing</div>
                    {outgoing.map((f) => (
                      <div key={f.id} className="text-xs py-1.5 border-b border-line/50 text-muted">
                        {label(f)} · pending
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Friends ({friends.length})</div>
                  {friends.length === 0 && <div className="text-xs text-muted">No friends yet — add by Grudge ID.</div>}
                  {friends.map((f) => (
                    <div key={f.id} className="flex items-center justify-between py-1.5 border-b border-line/50">
                      <div>
                        <div className="text-xs text-ink">{label(f)}</div>
                        {f.grudgeId && <div className="text-[10px] font-mono text-muted">{f.grudgeId}</div>}
                      </div>
                      <button className="btn ghost text-[10px]" onClick={() => void startDm(f.accountId)}>
                        Message
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── DMs list ── */}
            {subTab === "dms" && !inChat && (
              <div>
                {threads.length === 0 && (
                  <div className="text-xs text-muted py-6 text-center">
                    No DMs yet. Add a friend, then Message them.
                  </div>
                )}
                {threads.map((t) => (
                  <button
                    key={t.threadId}
                    type="button"
                    className="w-full text-left py-2 border-b border-line/50 hover:bg-bg-2/50 px-1"
                    onClick={() => {
                      setActiveGroupId(null);
                      setActiveThreadId(t.threadId);
                    }}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-ink">{t.displayName || t.grudgeId || "DM"}</span>
                      <span className="text-[10px] text-muted">{t.lastMessageAt ? fmtTime(t.lastMessageAt) : ""}</span>
                    </div>
                    <div className="text-[11px] text-muted truncate mt-0.5">
                      {t.lastMessage || "—"}
                      {t.unread > 0 && (
                        <span className="ml-2 text-gold">({t.unread})</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* ── Groups list ── */}
            {subTab === "groups" && !inChat && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    className="flex-1 text-xs"
                    placeholder="New group name…"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void createGroup()}
                  />
                  <button className="btn text-xs flex items-center gap-1" disabled={creatingGroup} onClick={() => void createGroup()}>
                    <Plus size={12} /> {creatingGroup ? "…" : "Create"}
                  </button>
                </div>
                {groups.length === 0 && <div className="text-xs text-muted">No groups yet.</div>}
                {groups.map((g) => (
                  <button
                    key={g.groupId}
                    type="button"
                    className="w-full text-left py-2 border-b border-line/50 hover:bg-bg-2/50 px-1"
                    onClick={() => {
                      setActiveThreadId(null);
                      setActiveGroupId(g.groupId);
                    }}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-ink">{g.name}</span>
                      <span className="text-[10px] text-muted">{g.memberCount} members</span>
                    </div>
                    <div className="text-[11px] text-muted truncate mt-0.5">
                      {g.lastMessage || g.description || "—"}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* ── Active chat ── */}
            {inChat && (
              <div className="flex flex-col h-full min-h-[360px]">
                <div className="flex items-center gap-2 pb-2 border-b border-line mb-2 shrink-0">
                  <button
                    type="button"
                    className="btn ghost text-xs px-2"
                    onClick={() => {
                      setActiveThreadId(null);
                      setActiveGroupId(null);
                    }}
                  >
                    <ArrowLeft size={12} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gold truncate">
                      {activeThread?.displayName || activeGroup?.name || "Chat"}
                    </div>
                    {activeGroup && (
                      <div className="text-[10px] text-muted">{activeGroup.memberCount} members · {activeGroup.role}</div>
                    )}
                  </div>
                  {activeGroupId && (
                    <button type="button" className="btn ghost danger text-[10px]" onClick={() => void leave()}>
                      <LogOut size={11} /> Leave
                    </button>
                  )}
                </div>

                {activeGroupId && (
                  <div className="flex gap-2 mb-2 shrink-0">
                    <input
                      className="flex-1 text-[11px]"
                      placeholder="Invite by Grudge ID…"
                      value={inviteQuery}
                      onChange={(e) => setInviteQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void invite()}
                    />
                    <button type="button" className="btn ghost text-[10px]" onClick={() => void invite()}>
                      Invite
                    </button>
                  </div>
                )}

                <div className="flex-1 overflow-auto space-y-2 min-h-0 pr-1">
                  {chatMessages.length === 0 && (
                    <div className="text-xs text-muted text-center py-8">No messages yet — say hello.</div>
                  )}
                  {chatMessages.map((m) => {
                    const mine = who?.player && String(m.senderAccountId) === String(who.player.id);
                    return (
                      <div
                        key={m.id}
                        className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs ${
                          mine
                            ? "ml-auto bg-gold/15 border border-gold/30 text-ink"
                            : "mr-auto bg-bg-2 border border-line text-ink"
                        }`}
                      >
                        {!mine && m.senderDisplayName && (
                          <div className="text-[10px] text-gold mb-0.5">{m.senderDisplayName}</div>
                        )}
                        <div className="whitespace-pre-wrap break-words">{m.content}</div>
                        <div className="text-[9px] text-muted mt-0.5 text-right">{fmtTime(m.createdAt)}</div>
                      </div>
                    );
                  })}
                  <div ref={endRef} />
                </div>

                <div className="flex gap-2 pt-2 border-t border-line mt-2 shrink-0">
                  <input
                    className="flex-1 text-xs"
                    placeholder="Message…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button className="btn text-xs flex items-center gap-1" disabled={sending || !draft.trim()} onClick={() => void send()}>
                    <Send size={12} /> {sending ? "…" : "Send"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
