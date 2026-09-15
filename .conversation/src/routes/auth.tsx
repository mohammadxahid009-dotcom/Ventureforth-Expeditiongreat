import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Compass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/use-session";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Expedition Explorer Account" },
      {
        name: "description",
        content:
          "Log in or create an Expedition account to permanently save your fog-of-war map, trails, levels and active expeditions.",
      },
      { property: "og:title", content: "Sign in — Expedition Explorer Account" },
      {
        property: "og:description",
        content: "Your explored map, trails and expeditions, saved to your account forever.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

type Mode = "login" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading: sessionLoading } = useSession();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionLoading && session) navigate({ to: "/", replace: true });
  }, [session, sessionLoading, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (mode === "signup" && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (mode !== "forgot" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        navigate({ to: "/", replace: true });
      } else if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (err) throw err;
        if (data.session) navigate({ to: "/", replace: true });
        else setNotice("Account created. Check your email to confirm it, then log in.");
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (err) throw err;
        setNotice("Password reset link sent. Check your inbox.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-background px-5 py-10 text-foreground">
      <div
        aria-hidden
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(oklch(0.8 0.15 78 / .12) 1px, transparent 1px), linear-gradient(90deg, oklch(0.8 0.15 78 / .12) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(circle at 50% 40%, black, transparent 78%)",
        }}
      />
      <div className="relative z-10 w-full max-w-sm">
        <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.35em] text-accent">
          <Compass className="h-3.5 w-3.5" /> Expedition
        </p>
        <h1 className="mt-3 text-[1.5rem] font-bold leading-snug">
          {mode === "login" && "Welcome back, explorer."}
          {mode === "signup" && "Start your permanent map."}
          {mode === "forgot" && "Reset your password."}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {mode === "forgot"
            ? "We'll email you a link to set a new password."
            : "Your explored map, trails, levels and active expedition are saved to your account."}
        </p>

        <form onSubmit={submit} className="panel mt-7 rounded-2xl p-4">
          <Field
            label="EMAIL"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
          />
          {mode !== "forgot" && (
            <Field
              label="PASSWORD"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          )}
          {mode === "signup" && (
            <Field
              label="CONFIRM PASSWORD"
              type="password"
              value={confirm}
              onChange={setConfirm}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          )}

          <div className="ticks mt-4 h-1.5 rounded-full opacity-60" aria-hidden />

          <button
            type="submit"
            disabled={busy}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-xs font-bold tracking-[0.22em] text-primary-foreground transition-transform hover:brightness-110 active:translate-y-px disabled:opacity-70"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "login" && "LOG IN"}
            {mode === "signup" && "CREATE ACCOUNT"}
            {mode === "forgot" && "SEND RESET LINK"}
          </button>

          <div className="mt-4 flex flex-col gap-2 text-[10px] tracking-[0.18em] text-muted-foreground">
            {mode === "login" && (
              <>
                <button
                  type="button"
                  className="text-left hover:text-accent"
                  onClick={() => {
                    setMode("forgot");
                    setError(null);
                    setNotice(null);
                  }}
                >
                  FORGOT PASSWORD?
                </button>
                <button
                  type="button"
                  className="text-left hover:text-accent"
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                    setNotice(null);
                  }}
                >
                  CREATE ACCOUNT
                </button>
              </>
            )}
            {mode !== "login" && (
              <button
                type="button"
                className="text-left hover:text-accent"
                onClick={() => {
                  setMode("login");
                  setError(null);
                  setNotice(null);
                }}
              >
                BACK TO LOG IN
              </button>
            )}
          </div>
        </form>

        {error && <p className="mt-4 text-[11px] leading-snug text-destructive">{error}</p>}
        {notice && <p className="mt-4 text-[11px] leading-snug text-accent">{notice}</p>}
      </div>
    </main>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
}) {
  return (
    <label className="mt-3 block first:mt-0">
      <span className="text-[10px] tracking-[0.28em] text-muted-foreground">{label}</span>
      <input
        required
        type={type}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-border/70 bg-secondary/40 px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent"
      />
    </label>
  );
}
