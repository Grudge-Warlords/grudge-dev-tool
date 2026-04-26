import React, { useState } from "react";
import { toast } from "sonner";
import { LogIn, ShieldCheck, Loader2, KeyRound, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { puterSignIn } from "../lib/puter";

interface Props {
  onSignedIn: () => void;
}

export default function Login({ onSignedIn }: Props) {
  const [busy, setBusy] = useState<"idle" | "signin" | "manual">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [manualUuid, setManualUuid] = useState("");
  const [manualUsername, setManualUsername] = useState("");

  async function signIn() {
    setBusy("signin"); setErr(null);
    try {
      const { token, user } = await puterSignIn();
      const r = await window.grudge.auth.setSession(token, user);
      toast.success(`Signed in as ${user.username} \u00b7 ${r.grudgeId}`);
      onSignedIn();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      toast.error("Sign-in failed", { description: msg });
      setShowManual(true);  // surface the manual fallback when popup auth fails
    } finally {
      setBusy("idle");
    }
  }

  async function manualSignIn() {
    if (!manualToken.trim() || !manualUuid.trim() || !manualUsername.trim()) {
      setErr("All three fields are required for manual sign-in.");
      return;
    }
    setBusy("manual"); setErr(null);
    try {
      const user = { uuid: manualUuid.trim(), username: manualUsername.trim() };
      const r = await window.grudge.auth.setSession(manualToken.trim(), user);
      toast.success(`Signed in as ${user.username} \u00b7 ${r.grudgeId}`);
      onSignedIn();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      toast.error("Manual sign-in failed", { description: msg });
    } finally {
      setBusy("idle");
    }
  }

  function openPuterProfile() {
    window.grudge?.os?.openExternal?.("https://puter.com/?show_token=1");
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <div className="card max-w-md w-full text-center">
        <img
          src="./logo-256.png"
          alt="Grudge"
          width={84}
          height={84}
          className="mx-auto mb-3 rounded-full"
          style={{ boxShadow: "0 0 0 2px var(--gold-deep)" }}
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.dataset.fallback) {
              img.dataset.fallback = "1";
              img.src = "./favicon.ico";
            }
          }}
        />
        <h1 className="page-title" style={{ marginBottom: 4 }}>Sign in to Grudge</h1>
        <p className="muted text-sm" style={{ marginBottom: 18 }}>
          Your Grudge ID is created from your Puter account. Save data, ships, characters, and uploads sync to your Puter cloud.
        </p>

        <button
          className="btn flex items-center justify-center gap-2 w-full"
          onClick={signIn}
          disabled={busy !== "idle"}
        >
          {busy === "signin" ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
          {busy === "signin" ? "Signing in\u2026" : "Sign in / Create Grudge account"}
        </button>

        <div className="muted text-xs mt-3 flex items-center justify-center gap-1">
          <ShieldCheck size={12} /> Tokens stored in Windows Credential Vault
        </div>

        {err && (
          <div className="status-bad text-xs mt-3 break-words text-left">
            <strong>Sign-in failed:</strong> {err}
          </div>
        )}

        <div className="muted text-xs mt-4">
          New here? The Puter popup lets you sign up with Google, GitHub, or username/password.
          We mint your Grudge ID automatically.
        </div>

        {/* ----------------- Manual-paste fallback ----------------- */}
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="mt-4 text-xs text-muted hover:text-gold flex items-center gap-1 mx-auto"
        >
          {showManual ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          Sign in manually with a Puter token
        </button>
        {showManual && (
          <div className="mt-3 text-left text-xs space-y-2 border-t border-line pt-3">
            <div className="muted">
              If the popup doesn’t open, paste your Puter token + UUID + username directly. Grab them from
              <button onClick={openPuterProfile} className="text-gold inline-flex items-center gap-1 ml-1">
                puter.com profile <ExternalLink size={10} />
              </button>.
            </div>
            <input value={manualUsername} onChange={(e) => setManualUsername(e.target.value)} placeholder="username" />
            <input value={manualUuid} onChange={(e) => setManualUuid(e.target.value)} placeholder="uuid (from puter.auth.getUser)" />
            <input type="password" value={manualToken} onChange={(e) => setManualToken(e.target.value)} placeholder="puter auth token" />
            <button
              className="btn flex items-center justify-center gap-2 w-full"
              onClick={manualSignIn}
              disabled={busy !== "idle"}
            >
              {busy === "manual" ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
              Sign in with token
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
