import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Expedition" },
      {
        name: "description",
        content: "Choose a new password for your Expedition explorer account.",
      },
      { property: "og:title", content: "Set a new password — Expedition" },
      { property: "og:description", content: "Choose a new password for your Expedition account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("Passwords don't match.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setDone(true);
      setTimeout(() => navigate({ to: "/", replace: true }), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10 text-foreground">
      <div className="w-full max-w-sm">
        <p className="text-[10px] uppercase tracking-[0.35em] text-accent">Account</p>
        <h1 className="mt-3 text-[1.4rem] font-bold leading-snug">Set a new password</h1>
        <form onSubmit={submit} className="panel mt-6 rounded-2xl p-4">
          <label className="block">
            <span className="text-[10px] tracking-[0.28em] text-muted-foreground">
              NEW PASSWORD
            </span>
            <input
              required
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-border/70 bg-secondary/40 px-3 py-2.5 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="mt-3 block">
            <span className="text-[10px] tracking-[0.28em] text-muted-foreground">
              CONFIRM PASSWORD
            </span>
            <input
              required
              type="password"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-border/70 bg-secondary/40 px-3 py-2.5 text-sm outline-none focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={busy || done}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-xs font-bold tracking-[0.22em] text-primary-foreground disabled:opacity-70"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {done ? "PASSWORD UPDATED" : "UPDATE PASSWORD"}
          </button>
        </form>
        {error && <p className="mt-4 text-[11px] text-destructive">{error}</p>}
      </div>
    </main>
  );
}
