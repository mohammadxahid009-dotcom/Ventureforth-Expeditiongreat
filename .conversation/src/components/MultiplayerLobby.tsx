import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Loader2,
  Play,
  Radio,
  Swords,
  Timer,
  Users,
} from "lucide-react";
import { useHuntRealtime } from "@/hooks/use-hunt-realtime";
import {
  MAX_TIME_LIMIT_MINUTES,
  MIN_TIME_LIMIT_MINUTES,
  createHuntRoom,
  formatTimeLimit,
  joinHuntRoom,
  leaveHunt,
  startHunt,
  type HuntMode,
  type HuntRoom,
} from "@/lib/multiplayer";

type Props = {
  user: User;
  onClose: () => void;
  onHuntStarted: (room: HuntRoom) => void;
};

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default function MultiplayerLobby({ user, onClose, onHuntStarted }: Props) {
  const [mode, setMode] = useState<HuntMode>("team");
  const [room, setRoom] = useState<HuntRoom | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [timed, setTimed] = useState(false);
  const [limitMinutes, setLimitMinutes] = useState(30);

  const handleRoomChanged = useCallback((next: HuntRoom) => setRoom(next), []);
  const { room: liveRoom, players } = useHuntRealtime(room, user.id, null, handleRoomChanged);
  const activeRoom = liveRoom ?? room;
  const isHost = activeRoom?.host_user_id === user.id;

  useEffect(() => {
    if (activeRoom?.state === "active") onHuntStarted(activeRoom);
  }, [activeRoom?.id, activeRoom?.state, onHuntStarted]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setRoom(await createHuntRoom(mode, user));
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      setRoom(await joinHuntRoom(joinCode, user));
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!activeRoom) return;
    setBusy(true);
    setError(null);
    try {
      setRoom(await startHunt(activeRoom.id, timed ? limitMinutes : null));
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!activeRoom) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await leaveHunt(activeRoom.id);
      onClose();
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!activeRoom) return;
    try {
      await navigator.clipboard.writeText(activeRoom.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copy the room code manually: " + activeRoom.code);
    }
  };

  if (activeRoom) {
    const modeLabel = activeRoom.mode === "team" ? "TEAM HUNT" : "VS HUNT";
    return (
      <main className="relative min-h-[100dvh] overflow-hidden bg-background px-5 py-6 text-foreground">
        <GridBackdrop />
        <section className="relative z-10 mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-md flex-col">
          <button
            onClick={leave}
            disabled={busy}
            className="inline-flex w-fit items-center gap-2 text-[10px] tracking-[0.22em] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> LEAVE ROOM
          </button>

          <div className="mt-10">
            <p className="text-[10px] tracking-[0.3em] text-accent">{modeLabel}</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">Gather your expedition.</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Share the code. Everyone enters the same live hunt when the host starts.
            </p>
          </div>

          <button
            onClick={copyCode}
            className="panel mt-7 flex w-full items-center justify-between rounded-2xl p-5 text-left transition-colors hover:border-accent/50"
          >
            <span>
              <span className="block text-[9px] tracking-[0.28em] text-muted-foreground">
                ROOM CODE
              </span>
              <span className="coord-num mt-2 block text-3xl tracking-[0.2em] text-foreground">
                {activeRoom.code}
              </span>
            </span>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent">
              {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
            </span>
          </button>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-[10px] tracking-[0.25em] text-muted-foreground">
              EXPEDITION CREW
            </span>
            <span className="coord-num text-xs text-accent">{players.length}/4</span>
          </div>
          <div className="panel mt-3 overflow-hidden rounded-2xl">
            {players.map((player, index) => (
              <div
                key={player.user_id}
                className={`flex items-center justify-between gap-3 px-4 py-3.5 ${index ? "border-t border-border/60" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-accent/30 bg-accent/10 text-[10px] font-bold text-accent">
                    {player.display_name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="truncate text-sm font-medium">{player.display_name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[9px] tracking-[0.18em] text-muted-foreground">
                  {player.user_id === activeRoom.host_user_id ? (
                    <>
                      <Crown className="h-3.5 w-3.5 text-accent" /> HOST
                    </>
                  ) : (
                    <>
                      <Radio className="h-2 w-2 text-accent" /> READY
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>

          {isHost ? (
            <div className="panel mt-6 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[10px] tracking-[0.22em] text-muted-foreground">
                  <Timer className="h-3.5 w-3.5 text-accent" /> TIME LIMIT
                </span>
                <button
                  onClick={() => setTimed((value) => !value)}
                  role="switch"
                  aria-checked={timed}
                  aria-label="Toggle time limit"
                  className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${timed ? "border-accent bg-accent/30" : "border-border bg-secondary/50"}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${timed ? "left-6 bg-accent" : "left-0.5 bg-muted-foreground"}`}
                  />
                </button>
              </div>

              {timed ? (
                <>
                  <p className="coord-num mt-3 text-2xl text-accent">
                    {formatTimeLimit(limitMinutes)}
                  </p>
                  <input
                    type="range"
                    min={MIN_TIME_LIMIT_MINUTES}
                    max={MAX_TIME_LIMIT_MINUTES}
                    step={5}
                    value={limitMinutes}
                    onChange={(event) => setLimitMinutes(Number(event.target.value))}
                    aria-label="Match time limit in minutes"
                    className="mt-3 w-full accent-[var(--accent)]"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[5, 15, 30, 60, 90, 180].map((preset) => (
                      <button
                        key={preset}
                        onClick={() => setLimitMinutes(preset)}
                        className={`rounded-lg border px-2.5 py-1.5 text-[9px] tracking-[0.16em] transition-colors ${limitMinutes === preset ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:border-accent/40"}`}
                      >
                        {formatTimeLimit(preset)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                    Reach your destination before the clock hits zero, or the hunt is lost.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                  No clock. Turn this on for a timed hunt (5 minutes to 3 hours).
                </p>
              )}
            </div>
          ) : (
            <div className="panel mt-6 rounded-2xl p-4 text-[10px] tracking-[0.18em] text-muted-foreground">
              HOST SETS THE TIME LIMIT
            </div>
          )}

          {error && <p className="mt-4 text-xs leading-relaxed text-destructive">{error}</p>}

          <div className="mt-auto pt-8">
            {isHost ? (
              <button
                onClick={start}
                disabled={busy || activeRoom.state !== "waiting"}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-4 text-xs font-bold tracking-[0.22em] text-primary-foreground transition-transform hover:brightness-110 active:translate-y-px disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
                {busy ? "STARTING…" : "START HUNT"}
              </button>
            ) : (
              <div className="panel rounded-xl px-4 py-4 text-center text-[10px] tracking-[0.2em] text-muted-foreground">
                WAITING FOR HOST TO START
              </div>
            )}
            <p className="mt-4 text-center text-[10px] leading-relaxed text-muted-foreground">
              Your location is shared only with this room while the hunt is active.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-background px-5 py-6 text-foreground">
      <GridBackdrop />
      <section className="relative z-10 mx-auto w-full max-w-md">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-2 text-[10px] tracking-[0.22em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> BACK
        </button>

        <p className="mt-12 text-[10px] tracking-[0.3em] text-accent">MULTIPLAYER</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Choose your hunt.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your real surroundings become the shared expedition map.
        </p>

        <div className="mt-8 grid gap-3">
          <ModeCard
            active={mode === "team"}
            title="Team Hunt"
            detail="Explore together. Each player has a personal destination."
            icon={<Users className="h-5 w-5" />}
            onClick={() => setMode("team")}
          />
          <ModeCard
            active={mode === "vs"}
            title="VS Hunt"
            detail="Race to your own destination. First completion takes the hunt."
            icon={<Swords className="h-5 w-5" />}
            onClick={() => setMode("vs")}
          />
        </div>

        <button
          onClick={create}
          disabled={busy}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-4 text-xs font-bold tracking-[0.22em] text-primary-foreground transition-transform hover:brightness-110 active:translate-y-px disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "CREATING…" : "CREATE ROOM"}
        </button>

        <div className="my-7 flex items-center gap-3 text-[9px] tracking-[0.26em] text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> OR JOIN A CREW{" "}
          <span className="h-px flex-1 bg-border" />
        </div>

        <label className="block text-[10px] tracking-[0.2em] text-muted-foreground">
          ROOM CODE
        </label>
        <div className="mt-2 flex gap-2">
          <input
            value={joinCode}
            onChange={(event) =>
              setJoinCode(
                event.target.value
                  .replace(/[^a-z0-9]/gi, "")
                  .toUpperCase()
                  .slice(0, 6),
              )
            }
            onKeyDown={(event) => event.key === "Enter" && void join()}
            placeholder="ABC123"
            autoCapitalize="characters"
            maxLength={6}
            className="panel coord-num min-w-0 flex-1 rounded-xl border px-4 py-3 text-center text-lg tracking-[0.2em] outline-none placeholder:tracking-[0.2em] focus:border-accent"
          />
          <button
            onClick={join}
            disabled={busy || joinCode.length !== 6}
            className="rounded-xl border border-accent/40 px-4 text-[10px] font-bold tracking-[0.2em] text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
          >
            JOIN
          </button>
        </div>
        {error && <p className="mt-4 text-xs leading-relaxed text-destructive">{error}</p>}
      </section>
    </main>
  );
}

function ModeCard({
  active,
  title,
  detail,
  icon,
  onClick,
}: {
  active: boolean;
  title: string;
  detail: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`panel flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition-colors ${active ? "border-accent bg-accent/10" : "border-border hover:border-accent/40"}`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-background/70 text-accent">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-bold">{title}</span>
        <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

function GridBackdrop() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 opacity-50"
      style={{
        backgroundImage:
          "linear-gradient(oklch(0.8 0.15 78 / .12) 1px, transparent 1px), linear-gradient(90deg, oklch(0.8 0.15 78 / .12) 1px, transparent 1px)",
        backgroundSize: "56px 56px",
        maskImage: "radial-gradient(circle at 50% 36%, black, transparent 78%)",
      }}
    />
  );
}
