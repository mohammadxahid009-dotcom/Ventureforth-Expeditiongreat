import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  Compass,
  Loader2,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  acceptFriendRequest,
  declineFriendRequest,
  getFriendsOverview,
  removeFriend,
  saveFriendProfile,
  searchFriendProfiles,
  sendFriendRequest,
  type Friend,
  type FriendRequest,
  type FriendsOverview,
  type FriendSearchResult,
} from "@/lib/friends";

type FriendsPanelProps = {
  userId: string;
  onClose: () => void;
};

type Tab = "crew" | "discover" | "requests";

export default function FriendsPanel({ userId, onClose }: FriendsPanelProps) {
  const [overview, setOverview] = useState<FriendsOverview | null>(null);
  const [tab, setTab] = useState<Tab>("crew");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<FriendSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);

  async function refresh() {
    setError(null);
    try {
      const next = await getFriendsOverview();
      setOverview(next);
      setProfileName(next.profile.displayName);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your crew.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [userId]);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timeout = window.setTimeout(() => {
      searchFriendProfiles(query)
        .then((next) => {
          if (!cancelled) setResults(next);
        })
        .catch((cause) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : "Search failed.");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [search]);

  const requestCount = overview?.incoming.length ?? 0;
  const initials = useMemo(
    () =>
      (overview?.profile.displayName || profileName || "EX")
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
    [overview?.profile.displayName, profileName],
  );

  async function runAction(key: string, action: () => Promise<unknown>, message?: string) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await refresh();
      if (message) setProfileSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The expedition network rejected that.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-background px-4 py-5 text-foreground sm:px-6 sm:py-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(oklch(0.8 0.15 78 / .12) 1px, transparent 1px), linear-gradient(90deg, oklch(0.8 0.15 78 / .12) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(circle at 50% 0%, black, transparent 75%)",
        }}
      />
      <div className="relative z-10 mx-auto w-full max-w-xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <button
              onClick={onClose}
              className="mb-5 inline-flex items-center gap-2 text-[10px] tracking-[0.22em] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> BACK TO BASE
            </button>
            <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.35em] text-accent">
              <Users className="h-3.5 w-3.5" /> Expedition crew
            </p>
            <h1 className="mt-3 text-[1.65rem] font-bold leading-snug">Find your next co-explorer.</h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              Build a trusted crew for multiplayer hunts. Friend requests and your call sign are
              saved to your account.
            </p>
          </div>
          <div className="hidden rounded-2xl border border-accent/25 bg-accent/10 p-3 text-accent sm:block">
            <Compass className="h-6 w-6" />
          </div>
        </header>

        <section className="panel mt-7 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-accent/35 bg-accent/10 text-xs font-bold tracking-[0.2em] text-accent">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] tracking-[0.28em] text-muted-foreground">YOUR CALL SIGN</p>
              <div className="mt-1 flex gap-2">
                <input
                  value={profileName}
                  maxLength={32}
                  onChange={(event) => {
                    setProfileName(event.target.value);
                    setProfileSaved(false);
                  }}
                  placeholder="Name your explorer"
                  className="min-w-0 flex-1 border-b border-border bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-accent"
                />
                <button
                  disabled={
                    busy === "profile" ||
                    profileName.trim().length < 2 ||
                    profileName.trim().length > 32
                  }
                  onClick={() =>
                    void runAction(
                      "profile",
                      () => saveFriendProfile(profileName.trim()),
                      "saved",
                    )
                  }
                  className="rounded-lg border border-accent/35 px-3 py-1.5 text-[9px] font-bold tracking-[0.18em] text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
                >
                  {busy === "profile" ? <Loader2 className="h-3 w-3 animate-spin" /> : "SAVE"}
                </button>
              </div>
            </div>
          </div>
          {profileSaved && (
            <p className="mt-3 flex items-center gap-1.5 text-[10px] tracking-[0.12em] text-accent">
              <Check className="h-3 w-3" /> CALL SIGN SAVED
            </p>
          )}
        </section>

        <nav className="mt-5 grid grid-cols-3 gap-1 rounded-xl border border-border/70 bg-secondary/30 p-1">
          <TabButton active={tab === "crew"} onClick={() => setTab("crew")} label="CREW" />
          <TabButton active={tab === "discover"} onClick={() => setTab("discover")} label="ADD FRIEND" />
          <TabButton
            active={tab === "requests"}
            onClick={() => setTab("requests")}
            label="REQUESTS"
            count={requestCount}
          />
        </nav>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[11px] leading-relaxed text-destructive">
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="panel mt-4 grid min-h-44 place-items-center rounded-2xl">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          </div>
        ) : (
          <>
            {tab === "crew" && (
              <CrewList
                friends={overview?.friends ?? []}
                busy={busy}
                onRemove={(friend) =>
                  void runAction(`remove:${friend.userId}`, () => removeFriend(friend.userId))
                }
              />
            )}
            {tab === "discover" && (
              <Discover
                search={search}
                setSearch={setSearch}
                results={results}
                searching={searching}
                busy={busy}
                outgoing={overview?.outgoing ?? []}
                friends={overview?.friends ?? []}
                onSend={(result) =>
                  void runAction(`send:${result.userId}`, () => sendFriendRequest(result.userId))
                }
              />
            )}
            {tab === "requests" && (
              <Requests
                incoming={overview?.incoming ?? []}
                outgoing={overview?.outgoing ?? []}
                busy={busy}
                onAccept={(request) =>
                  void runAction(`accept:${request.id}`, () => acceptFriendRequest(request.id))
                }
                onDecline={(request) =>
                  void runAction(`decline:${request.id}`, () => declineFriendRequest(request.id))
                }
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

function TabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-lg px-2 py-2.5 text-[9px] font-bold tracking-[0.16em] transition-colors ${
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      {!!count && (
        <span className="ml-1.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[8px] text-primary-foreground">
          {count}
        </span>
      )}
    </button>
  );
}

function CrewList({
  friends,
  busy,
  onRemove,
}: {
  friends: Friend[];
  busy: string | null;
  onRemove: (friend: Friend) => void;
}) {
  return (
    <section className="mt-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="text-[10px] tracking-[0.25em] text-accent">ACTIVE CREW</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {friends.length ? `${friends.length} explorer${friends.length === 1 ? "" : "s"} connected` : "No one on your roster yet"}
          </p>
        </div>
        <ShieldCheck className="h-4 w-4 text-accent/70" />
      </div>
      {friends.length === 0 ? (
        <EmptyState
          icon={<UserPlus className="h-5 w-5" />}
          title="Your crew is waiting."
          detail="Search for a call sign to send your first invite."
        />
      ) : (
        <div className="space-y-2">
          {friends.map((friend) => (
            <div key={friend.userId} className="panel flex items-center gap-3 rounded-xl p-3">
              <Avatar name={friend.displayName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{friend.displayName}</p>
                <p className="mt-0.5 text-[9px] tracking-[0.14em] text-muted-foreground">
                  CREW MEMBER · READY FOR A HUNT
                </p>
              </div>
              <button
                onClick={() => onRemove(friend)}
                disabled={busy === `remove:${friend.userId}`}
                className="rounded-lg px-2 py-1.5 text-[9px] tracking-[0.14em] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                {busy === `remove:${friend.userId}` ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "REMOVE"
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Discover({
  search,
  setSearch,
  results,
  searching,
  busy,
  outgoing,
  friends,
  onSend,
}: {
  search: string;
  setSearch: (value: string) => void;
  results: FriendSearchResult[];
  searching: boolean;
  busy: string | null;
  outgoing: FriendRequest[];
  friends: Friend[];
  onSend: (result: FriendSearchResult) => void;
}) {
  const friendIds = new Set(friends.map((friend) => friend.userId));
  const outgoingIds = new Set(outgoing.map((request) => request.receiverUserId));
  return (
    <section className="mt-4">
      <div className="panel flex items-center gap-2 rounded-xl px-3 py-2.5">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search a call sign…"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        />
        {searching && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
      </div>
      <p className="mt-3 px-1 text-[10px] leading-relaxed text-muted-foreground">
        Search is limited to explorers who have opened their crew profile. Your email stays private.
      </p>
      {search.trim().length < 2 ? (
        <EmptyState
          icon={<Search className="h-5 w-5" />}
          title="Start with two letters."
          detail="Call signs are easier to find than email addresses."
        />
      ) : results.length === 0 && !searching ? (
        <EmptyState
          icon={<Compass className="h-5 w-5" />}
          title="No explorers found."
          detail="Try another call sign or invite a friend who has opened this screen."
        />
      ) : (
        <div className="mt-4 space-y-2">
          {results.map((result) => {
            const alreadyFriend = friendIds.has(result.userId);
            const alreadySent = outgoingIds.has(result.userId);
            return (
              <div key={result.userId} className="panel flex items-center gap-3 rounded-xl p-3">
                <Avatar name={result.displayName} />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">{result.displayName}</p>
                {alreadyFriend ? (
                  <span className="text-[9px] tracking-[0.14em] text-accent">IN CREW</span>
                ) : alreadySent ? (
                  <span className="text-[9px] tracking-[0.14em] text-muted-foreground">SENT</span>
                ) : (
                  <button
                    onClick={() => onSend(result)}
                    disabled={busy === `send:${result.userId}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[9px] font-bold tracking-[0.14em] text-primary-foreground transition-colors hover:brightness-110 disabled:opacity-50"
                  >
                    {busy === `send:${result.userId}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <UserPlus className="h-3 w-3" />
                    )}
                    ADD
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Requests({
  incoming,
  outgoing,
  busy,
  onAccept,
  onDecline,
}: {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  busy: string | null;
  onAccept: (request: FriendRequest) => void;
  onDecline: (request: FriendRequest) => void;
}) {
  return (
    <section className="mt-4 space-y-6">
      <RequestGroup
        title="INCOMING"
        detail="Explorers asking to join your crew"
        requests={incoming}
        busy={busy}
        incoming
        onAccept={onAccept}
        onDecline={onDecline}
      />
      <RequestGroup
        title="OUTGOING"
        detail="Invites waiting for a response"
        requests={outgoing}
        busy={busy}
        onAccept={onAccept}
        onDecline={onDecline}
      />
    </section>
  );
}

function RequestGroup({
  title,
  detail,
  requests,
  busy,
  incoming = false,
  onAccept,
  onDecline,
}: {
  title: string;
  detail: string;
  requests: FriendRequest[];
  busy: string | null;
  incoming?: boolean;
  onAccept: (request: FriendRequest) => void;
  onDecline: (request: FriendRequest) => void;
}) {
  return (
    <div>
      <p className="text-[10px] tracking-[0.25em] text-accent">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      {requests.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-4 text-center text-[10px] tracking-[0.12em] text-muted-foreground">
          NONE RIGHT NOW
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {requests.map((request) => {
            const displayName = incoming ? request.senderDisplayName : request.receiverDisplayName;
            return (
              <div key={request.id} className="panel flex items-center gap-3 rounded-xl p-3">
                <Avatar name={displayName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{displayName}</p>
                  <p className="mt-0.5 text-[9px] tracking-[0.12em] text-muted-foreground">
                    {incoming ? "WANTS TO EXPLORE WITH YOU" : "AWAITING RESPONSE"}
                  </p>
                </div>
                {incoming ? (
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => onAccept(request)}
                      disabled={busy === `accept:${request.id}`}
                      className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                      aria-label={`Accept ${displayName}`}
                    >
                      {busy === `accept:${request.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => onDecline(request)}
                      disabled={busy === `decline:${request.id}`}
                      className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground hover:text-destructive disabled:opacity-50"
                      aria-label={`Decline ${displayName}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="text-[9px] tracking-[0.14em] text-muted-foreground">PENDING</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-accent/25 bg-accent/10 text-[10px] font-bold tracking-[0.14em] text-accent">
      {name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="panel mt-4 grid place-items-center rounded-2xl px-5 py-10 text-center">
      <div className="text-accent">{icon}</div>
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}