import React, { useState } from "react";
import { toast } from "sonner";
import { LogIn, ShieldCheck, Loader2 } from "lucide-react";
import { puterSignIn } from "../lib/puter";

interface Props {
  onSignedIn: () => void;
}

export default function Login({ onSignedIn }: Props) {
  const [busy, setBusy] = useState<"idle" | "signin">("idle");
  const [err, setErr] = useState<string | null>(null);

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
    } finally {
      setBusy("idle");
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <div className="card max-w-md w-full text-center">
        <img src="/logo-256.png" alt="Grudge" width={84} height={84} className="mx-auto mb-3 rounded-full" style={{ boxShadow: "0 0 0 2px var(--gold-deep)" }} />
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
          <div className="status-bad text-xs mt-3 break-words">
            {err}
          </div>
        )}

        <div className="muted text-xs mt-4">
          New here? The Puter popup lets you sign up with Google, GitHub, or username/password.
          We mint your Grudge ID automatically.
        </div>
      </div>
    </div>
  );
}
