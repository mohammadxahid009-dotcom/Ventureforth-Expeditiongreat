import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type L from "leaflet";
import {
  Compass,
  Crosshair,
  Minus,
  Plus,
  Flag,
  Navigation,
  X as XIcon,
  Loader2,
  Trophy,
  LogOut,
  Camera,
  Timer,
  Users,
  UserPlus,
} from "lucide-react";
import {
  ARRIVAL_RADIUS,
  DEFAULT_CONE,
  bearingDegrees,
  compassLabel,
  distanceMeters,
  formatDistance,
  globalAddress,
  isDiscovered,
  pickDestinationInCone,
  rollDestination,
  walkMinutes,
  type Cone,
  type LatLng,
} from "@/lib/expedition";
import { useHeading } from "@/lib/use-heading";
import { useSession } from "@/lib/use-session";
import { loadProgress, saveProgress, type Progress } from "@/lib/progress";
import { addPhoto, deletePhoto, listPhotos, updatePhoto, type PhotoMemory } from "@/lib/photos";
import { supabase } from "@/integrations/supabase/client";
import MultiplayerLobby from "@/components/MultiplayerLobby";
import { useHuntRealtime } from "@/hooks/use-hunt-realtime";
import FriendsPanel from "@/components/FriendsPanel";
import {
  assignHuntTarget,
  completeHuntTarget,
  expireHunt,
  formatCountdown,
  leaveHunt,
  loadMyHuntTarget,
  type HuntRoom,
} from "@/lib/multiplayer";
import { useRedzone } from "@/lib/redzone";

/** Milliseconds left on a hunt deadline, ticking once a second. */
function useHuntCountdown(
  expiresAt: string | null | undefined,
  extraElapsedMs = 0,
) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) {
      setLeft(null);
      return;
    }
    const deadline = Date.parse(expiresAt);
    if (Number.isNaN(deadline)) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(deadline - Date.now() - extraElapsedMs);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, extraElapsedMs]);
  return left;
}

const ExpeditionMap = lazy(() => import("@/components/ExpeditionMap"));
const DirectionTool = lazy(() => import("@/components/DirectionTool"));
const PhotoMemories = lazy(() => import("@/components/PhotoMemories"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Expedition — Real-World Exploration Game" },
      {
        name: "description",
        content:
          "Turn your city into a game map. Pick a direction, get a mystery destination, reveal the fog by walking and level up when you arrive.",
      },
      { property: "og:title", content: "Expedition — Real-World Exploration Game" },
      {
        property: "og:description",
        content:
          "Fog of war, a coordinate grid world and your live GPS position. Go outside and explore.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Phase = "start" | "locating" | "active";
const TRAIL_STEP = 45; // metres between recorded discovery points
const SAVE_DEBOUNCE = 8000; // ms — batch frequent trail growth into one write
/** Fixes coarser than this never reveal fog or enter the trail. */
const REVEAL_MAX_ACCURACY = 500;
/** Faster than this (m/s) = GPS glitch, not a human moving. */
const MAX_HUMAN_SPEED = 12;
/** Gap between trail points beyond which fog must not draw a streak. */
export const MAX_TRAIL_GAP = 500;

/** Glide the on-screen position between GPS fixes so the X/Z console counts
 *  up continuously instead of jumping. Gameplay logic still uses raw fixes. */
function useSmoothPosition(target: LatLng | null) {
  const [pos, setPos] = useState<LatLng | null>(target);
  const curRef = useRef<LatLng | null>(target);
  const targetRef = useRef<LatLng | null>(target);
  targetRef.current = target;
  const active = target !== null;

  useEffect(() => {
    if (!active) {
      curRef.current = null;
      setPos(null);
      return;
    }
    if (!curRef.current && targetRef.current) {
      curRef.current = targetRef.current;
      setPos(targetRef.current);
    }
    let raf = 0;
    let last = performance.now();
    let lastPush = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const t = targetRef.current;
      const c = curRef.current;
      if (!t || !c) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const gap = distanceMeters(c, t);
      if (gap > 40) {
        // genuine jump (signal recovered elsewhere): snap, don't streak
        curRef.current = t;
        setPos(t);
        return;
      }
      // deadband: hold still against sub-foot GPS jitter
      if (gap < 0.15) return;
      const k = 1 - Math.exp(-dt / 0.45); // converge in roughly half a second
      curRef.current = { lat: c.lat + (t.lat - c.lat) * k, lng: c.lng + (t.lng - c.lng) * k };
      if (now - lastPush >= 50) {
        lastPush = now;
        setPos(curRef.current);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return pos;
}

/** Drop lone GPS glitches, but never discard genuinely explored ground. */
function cleanTrail(trail: LatLng[]) {
  if (trail.length < 8) return trail;
  const kept = trail.filter((p, i) => {
    const near = trail.some((q, j) => j !== i && distanceMeters(p, q) <= MAX_TRAIL_GAP);
    return near;
  });
  // safety net: if the filter would erase most of the map, keep everything
  return kept.length >= trail.length * 0.6 ? kept : trail;
}

function Index() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useSession();
  const [phase, setPhase] = useState<Phase>("start");
  const [multiplayerOpen, setMultiplayerOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [multiplayerRoom, setMultiplayerRoom] = useState<HuntRoom | null>(null);
  const [player, setPlayer] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [fixAge, setFixAge] = useState(0);
  const { heading, begin: startCompass, pushGps } = useHeading();
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [trail, setTrail] = useState<LatLng[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [level, setLevel] = useState(1);
  const [completed, setCompleted] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  const [toolOpen, setToolOpen] = useState(false);
  const [mapObj, setMapObj] = useState<L.Map | null>(null);
  const [mapRotation, setMapRotation] = useState(0);
  const [photos, setPhotos] = useState<PhotoMemory[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [cone, setCone] = useState<Cone>(DEFAULT_CONE);
  const [scouting, setScouting] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [savedDestination, setSavedDestination] = useState<LatLng | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const watchRef = useRef<number | null>(null);
  const prevRef = useRef<LatLng | null>(null);
  const lastRevealRef = useRef<{ point: LatLng; at: number } | null>(null);
  const lastFixRef = useRef<number>(Date.now());
  const progressRef = useRef<Progress>({
    level: 1,
    completed: 0,
    trail: [],
    destination: null,
    expeditionActive: false,
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;
  const {
    room: liveHuntRoom,
    players: huntPlayers,
    remotePlayers,
  } = useHuntRealtime(multiplayerRoom, user?.id, player);
  const huntRoom = liveHuntRoom ?? multiplayerRoom;
  const inMultiplayer = huntRoom !== null;
  const redzoneActive = Boolean(huntRoom?.state === "active" && huntRoom.expires_at);
  const {
    zone: redzone,
    discovered: redzoneDiscovered,
    inside: insideRedzone,
    penaltyMs: redzonePenaltyMs,
  } = useRedzone({
    active: redzoneActive,
    roomId: huntRoom?.id ?? null,
    userId: user?.id,
    player,
    destination,
    heading,
  });
  const huntWinner =
    huntPlayers.find((candidate) => candidate.user_id === huntRoom?.winner_user_id) ?? null;
  const huntTimeLeft = useHuntCountdown(
    huntRoom?.state === "active" ? huntRoom.expires_at : null,
    redzonePenaltyMs,
  );
  const huntTimeUp = huntTimeLeft !== null && huntTimeLeft <= 0;
  const expiredRef = useRef<string | null>(null);

  // ── the host's clock runs out: close the hunt for everyone ────
  useEffect(() => {
    if (!huntRoom || !huntTimeUp || expiredRef.current === huntRoom.id) return;
    expiredRef.current = huntRoom.id;
    void expireHunt(huntRoom.id).catch(() => {});
  }, [huntRoom?.id, huntTimeUp]);

  // ── signed-out visitors go to the account screen ─────────────
  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth", replace: true });
  }, [authLoading, user, navigate]);

  // ── restore this player's saved progress ─────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    setRestoring(true);
    loadProgress(user.id).then((p) => {
      if (cancelled) return;
      const cleaned = cleanTrail(p.trail);
      progressRef.current = { ...p, trail: cleaned };
      setLevel(p.level);
      setCompleted(p.completed);
      setTrail(cleaned);
      setSavedDestination(p.expeditionActive ? p.destination : null);
      setRestoring(false);
      if (cleaned.length !== p.trail.length) {
        const repaired = { ...p, trail: cleaned };
        progressRef.current = repaired;
        void saveProgress(user.id, repaired);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // ── photo memories ───────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listPhotos(user.id).then((ps) => {
      if (!cancelled) setPhotos(ps);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const onPickPhoto = useCallback(async (file: File) => {
    const map = mapRef.current;
    const id = userIdRef.current;
    if (!file || !map || !id) return;
    setUploading(true);
    try {
      const c = map.getCenter();
      const a = map.containerPointToLatLng([0, 0] as unknown as [number, number]);
      const b = map.containerPointToLatLng([100, 0] as unknown as [number, number]);
      const metresPer100px = map.distance(a, b);
      const sizeM = Math.max(2, (metresPer100px / 100) * 110);
      const created = await addPhoto(id, file, { lat: c.lat, lng: c.lng }, sizeM);
      if (created) setPhotos((ps) => [...ps, created]);
    } finally {
      setUploading(false);
    }
  }, []);

  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const id = userIdRef.current;
    if (!id) return;
    void saveProgress(id, progressRef.current);
  }, []);

  /** Record progress locally, then write it out (debounced unless immediate). */
  const persist = useCallback(
    (patch: Partial<Progress>, immediate = false) => {
      progressRef.current = { ...progressRef.current, ...patch };
      if (!userIdRef.current) return;
      if (immediate) {
        flushSave();
        return;
      }
      if (saveTimer.current) return;
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        flushSave();
      }, SAVE_DEBOUNCE);
    },
    [flushSave],
  );

  // keep newly revealed ground saved without a write per GPS fix
  useEffect(() => {
    if (restoring || !user || trail.length === 0) return;
    // never let a shorter in-memory trail overwrite saved exploration
    if (trail.length < progressRef.current.trail.length) return;
    persist({ trail });
  }, [trail, restoring, user, persist]);

  // last-chance save when the tab is hidden or closed
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushSave);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushSave);
    };
  }, [flushSave]);

  const stopTracking = useCallback(() => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
  }, []);

  useEffect(() => () => stopTracking(), [stopTracking]);

  useEffect(() => {
    if (phase !== "active") return;
    const id = setInterval(
      () => setFixAge(Math.round((Date.now() - lastFixRef.current) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [phase]);

  const revealAt = useCallback((p: LatLng) => {
    setTrail((t) => {
      const last = t[t.length - 1];
      if (last && distanceMeters(last, p) < TRAIL_STEP) return t;
      return [...t, p];
    });
  }, []);

  const begin = useCallback(
    (room?: HuntRoom) => {
      if (!("geolocation" in navigator)) {
        setError("This device has no GPS support.");
        return;
      }
      setError(null);
      setPhase("locating");
      startCompass();

      const onFix = (p: GeolocationPosition) => {
        const next = { lat: p.coords.latitude, lng: p.coords.longitude };
        const now = p.timestamp || Date.now();
        lastFixRef.current = Date.now();
        const nextAccuracy = p.coords.accuracy ?? null;
        setAccuracy((current) =>
          current === null || nextAccuracy === null || Math.abs(current - nextAccuracy) >= 1
            ? nextAccuracy
            : current,
        );
        const moved = prevRef.current ? distanceMeters(prevRef.current, next) : 0;
        if (
          p.coords.heading !== null &&
          !Number.isNaN(p.coords.heading) &&
          (p.coords.speed ?? 0) > 0.5
        ) {
          pushGps(p.coords.heading);
        } else if (prevRef.current && moved > 3) {
          pushGps(bearingDegrees(prevRef.current, next));
        }
        prevRef.current = next;
        setPlayer((current) => (!current || distanceMeters(current, next) >= 1 ? next : current));

        // Always uncover the very first fix so the player can see themselves,
        // even on a weak signal; later points still need a usable accuracy.
        if (lastRevealRef.current && nextAccuracy !== null && nextAccuracy > REVEAL_MAX_ACCURACY)
          return;
        const lastReveal = lastRevealRef.current;
        if (lastReveal) {
          const revealGap = distanceMeters(lastReveal.point, next);
          const elapsed = Math.max(0.25, (now - lastReveal.at) / 1000);
          const reportedSpeed = p.coords.speed;
          const speed =
            reportedSpeed !== null && reportedSpeed >= 0 ? reportedSpeed : revealGap / elapsed;
          if (revealGap > MAX_TRAIL_GAP || speed > MAX_HUMAN_SPEED) return;
        }
        lastRevealRef.current = { point: next, at: now };
        revealAt(next);
      };

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          onFix(pos);
          // Solo expeditions retain their saved destination. Multiplayer targets stay private per player but use the same Lat/Lng and global X/Z model.
          const existingTarget =
            room && userIdRef.current
              ? await loadMyHuntTarget(room.id, userIdRef.current).catch(() => null)
              : null;
          const dest =
            existingTarget ??
            (room ? rollDestination(here) : (savedDestination ?? rollDestination(here)));
          setDestination(dest);
          if (room) {
            void assignHuntTarget(room.id, dest).catch((cause: unknown) => {
              setError(
                cause instanceof Error ? cause.message : "Could not assign your hunt target.",
              );
            });
          } else {
            persist({ destination: dest, expeditionActive: true }, true);
          }
          setCelebrating(false);
          setPhase("active");
          watchRef.current = navigator.geolocation.watchPosition(onFix, () => {}, {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 30000,
          });
        },
        (err) => {
          setPhase("start");
          setError(
            err.code === err.PERMISSION_DENIED
              ? "Location permission denied. Enable it to start an expedition."
              : "Could not get your position. Try again outdoors.",
          );
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
      );
    },
    [persist, pushGps, revealAt, savedDestination, startCompass],
  );

  const end = useCallback(() => {
    stopTracking();
    if (multiplayerRoom) void leaveHunt(multiplayerRoom.id);
    setMultiplayerRoom(null);
    prevRef.current = null;
    lastRevealRef.current = null;
    setDestination(null);
    setPlayer(null);
    // the explored map is permanent — never clear the trail here
    setAccuracy(null);
    setCelebrating(false);
    setToolOpen(false);
    setPhase("start");
  }, [stopTracking, multiplayerRoom]);

  // raw fixes drive fog/arrival; the smoothed position drives display
  const smoothPlayer = useSmoothPosition(player);

  const dist = player && destination ? distanceMeters(player, destination) : Infinity;
  const arrived = dist <= ARRIVAL_RADIUS;

  // Solo keeps its existing level progression. Multiplayer completion is stored against the room instead.
  useEffect(() => {
    if (phase !== "active" || !arrived || celebrating) return;
    if (huntRoom) {
      setCelebrating(true);
      void completeHuntTarget(huntRoom.id).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not record the completed target.");
      });
      return;
    }
    setCelebrating(true);
    setLevel((l) => {
      const next = l + 1;
      setCompleted((c) => {
        persist({ level: next, completed: c + 1 }, true);
        return c + 1;
      });
      return next;
    });
  }, [arrived, phase, celebrating, persist, huntRoom]);

  useEffect(() => {
    if (huntRoom?.mode === "vs" && huntRoom.state === "finished") setCelebrating(true);
  }, [huntRoom?.id, huntRoom?.mode, huntRoom?.state]);

  const rollNext = useCallback(
    async (withCone?: Cone) => {
      if (!player || inMultiplayer) return;
      setScouting(true);
      try {
        const next = withCone
          ? await pickDestinationInCone(player, withCone)
          : rollDestination(player);
        setDestination(next);
        setCelebrating(false);
        setToolOpen(false);
        setFollow(true);
      } finally {
        setScouting(false);
      }
    },
    [player, inMultiplayer],
  );

  const handleHuntStarted = useCallback(
    (room: HuntRoom) => {
      setMultiplayerOpen(false);
      setMultiplayerRoom(room);
      begin(room);
    },
    [begin],
  );

  if (multiplayerOpen && user) {
    return (
      <MultiplayerLobby
        user={user}
        onClose={() => setMultiplayerOpen(false)}
        onHuntStarted={handleHuntStarted}
      />
    );
  }

  if (friendsOpen && user) {
    return <FriendsPanel userId={user.id} onClose={() => setFriendsOpen(false)} />;
  }

  if (phase !== "active" || !player || !destination) {
    return (
      <StartScreen
        onBegin={begin}
        onMultiplayer={() => setMultiplayerOpen(true)}
        onFriends={() => setFriendsOpen(true)}
        loading={phase === "locating"}
        error={error}
        level={level}
      />
    );
  }

  const bearing = bearingDegrees(player, destination);
  const destVisible = isDiscovered(destination, trail);
  const me = smoothPlayer ?? player;
  const pc = globalAddress(me);
  const dc = globalAddress(destination);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      <Suspense fallback={<div className="absolute inset-0 bg-background" />}>
        <ExpeditionMap
          player={me}
          heading={heading}
          destination={destination}
          destinationVisible={destVisible}
          trail={trail}
          otherPlayers={remotePlayers.map((peer) => ({
            id: peer.user_id,
            name: peer.display_name,
            location: peer.location,
            connected: peer.connected,
          }))}
          arrived={celebrating}
          follow={follow && !toolOpen}
          onUserPan={() => setFollow(false)}
          onRotate={setMapRotation}
          onMapReady={(m) => {
            mapRef.current = m;
            setMapObj(m);
          }}
            redzone={
              redzone && redzoneDiscovered
                ? {
                    center: redzone.center,
                    radius: redzone.radius,
                    expiresAt: redzone.expiresAt,
                    inside: insideRedzone,
                  }
                : null
            }
        />
      </Suspense>

      {redzoneDiscovered && redzone && (
        <div
          className={`absolute right-3 top-[4.6rem] z-[500] flex items-center gap-2 rounded-xl border px-3 py-2 text-[9px] font-bold tracking-[0.18em] ${
            insideRedzone
              ? "border-destructive/55 bg-destructive/15 text-destructive"
              : "border-destructive/30 bg-background/75 text-destructive/80"
          }`}
        >
          <span className="redzone-pip" />
          {insideRedzone ? "REDZONE · TIME DRAINING" : "REDZONE · AVOID"}
        </div>
      )}

      {/* top strip */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] p-3">
        <div className="panel pointer-events-auto flex items-center justify-between gap-3 rounded-xl px-3 py-2">
          <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {inMultiplayer ? (
              <>
                <span className="flex items-center gap-1.5 text-accent">
                  <Users className="h-3.5 w-3.5" />
                  {huntRoom?.mode === "vs" ? "VS HUNT" : "TEAM HUNT"}
                </span>
                <span className="opacity-50">·</span>
                <span>{huntPlayers.length}/4</span>
                {huntTimeLeft !== null && (
                  <>
                    <span className="opacity-50">·</span>
                    <span
                      className={`coord-num tracking-normal ${huntTimeLeft <= 60000 ? "text-destructive" : "text-foreground"}`}
                    >
                      {formatCountdown(huntTimeLeft)}
                    </span>
                  </>
                )}
              </>
            ) : (
              <>
                <span className="text-accent">LVL {level}</span>
                <span className="opacity-50">·</span>
                {completed} FOUND
              </>
            )}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] tracking-[0.18em] text-muted-foreground">
            <span
              className={
                fixAge < 8
                  ? "h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]"
                  : "h-1.5 w-1.5 rounded-full bg-destructive"
              }
            />
            GPS {accuracy !== null ? `±${Math.round(accuracy)} m` : "—"}
          </span>
        </div>
      </div>

      {/* distance + compass, top centre */}
      {!celebrating && (
        <div className="pointer-events-none absolute inset-x-0 top-[4.6rem] z-[500] flex flex-col items-center gap-2">
          <div className="panel flex items-center gap-3 rounded-xl px-4 py-2.5">
            <Compass
              className="h-6 w-6 shrink-0 text-accent transition-transform duration-300"
              style={{ transform: `rotate(${bearing}deg)` }}
            />
            <div className="leading-none">
              <p className="coord-num text-lg">{formatDistance(dist)}</p>
              <p className="mt-1 text-[9px] tracking-[0.2em] text-muted-foreground">
                {compassLabel(bearing)} · ~{walkMinutes(dist)} MIN WALK
                {!destVisible && " · UNCHARTED"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* directional destination tool */}
      {toolOpen && mapRef.current && (
        <Suspense fallback={null}>
          <DirectionTool
            map={mapRef.current}
            player={player}
            cone={cone}
            onChange={setCone}
            onConfirm={() => rollNext(cone)}
            onCancel={() => setToolOpen(false)}
            busy={scouting}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <PhotoMemories
          map={mapObj}
          rotation={mapRotation}
          photos={photos}
          onMove={(id, at) => {
            setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, ...at } : p)));
            void updatePhoto(id, at);
          }}
          onResize={(id, sizeM) => {
            setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, sizeM } : p)));
            void updatePhoto(id, { sizeM });
          }}
          onDelete={(photo) => {
            setPhotos((ps) => ps.filter((p) => p.id !== photo.id));
            void deletePhoto(photo);
          }}
        />
      </Suspense>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onPickPhoto(f);
        }}
      />

      {/* controls, thumb side */}
      {!toolOpen && (
        <div className="absolute bottom-56 right-3 z-[500] flex flex-col gap-2">
          <button className="ctrl" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            <Plus className="h-4 w-4" />
          </button>
          <button className="ctrl" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
            <Minus className="h-4 w-4" />
          </button>
          <button
            className="ctrl"
            aria-label="Recenter on me"
            onClick={() => {
              setFollow(true);
              mapRef.current?.setView([player.lat, player.lng], 16);
            }}
          >
            <Crosshair className="h-4 w-4" />
          </button>
          <button
            className="ctrl"
            aria-label="Choose a direction to explore"
            onClick={() => {
              setFollow(true);
              mapRef.current?.setView([player.lat, player.lng], 13);
              setToolOpen(true);
            }}
          >
            <Navigation className="h-4 w-4 text-accent" />
          </button>
          <button
            className="ctrl"
            aria-label="Show the whole route"
            disabled={!destVisible}
            onClick={() => {
              setFollow(false);
              mapRef.current?.fitBounds(
                [
                  [player.lat, player.lng],
                  [destination.lat, destination.lng],
                ],
                { padding: [70, 70] },
              );
            }}
          >
            <Flag className={destVisible ? "h-4 w-4" : "h-4 w-4 opacity-30"} />
          </button>
          <button
            className="ctrl"
            aria-label="Pin a photo memory here"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
          </button>
        </div>
      )}

      {/* time pressure ran out */}
      {huntTimeUp && !celebrating && (
        <div className="absolute inset-0 z-[570] grid place-items-center bg-background/80 p-6">
          <div className="panel w-full max-w-xs rounded-2xl p-5 text-center">
            <Timer className="mx-auto h-7 w-7 text-destructive" />
            <p className="mt-3 text-base font-bold tracking-[0.24em] text-destructive">
              TIME&apos;S UP
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              The clock hit zero before you reached your mark. The hunt is lost — everything you
              uncovered stays on your map.
            </p>
            <div className="ticks mt-4 h-1.5 rounded-full opacity-60" aria-hidden />
            <button
              onClick={end}
              className="mt-4 w-full rounded-xl bg-primary px-4 py-3 text-[10px] font-bold tracking-[0.22em] text-primary-foreground"
            >
              BACK TO BASE
            </button>
          </div>
        </div>
      )}

      {/* completion */}
      {celebrating && (
        <div className="pointer-events-none absolute inset-0 z-[560] grid place-items-center p-6">
          <div className="aura-burst" aria-hidden />
          <div className="panel pointer-events-auto relative w-full max-w-xs rounded-2xl p-5 text-center">
            <Trophy className="mx-auto h-7 w-7 text-accent" />
            <p className="mt-3 text-base font-bold tracking-[0.24em] text-accent">
              LEVEL COMPLETED
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              You physically reached the mark. Level {level} unlocked · {completed} expeditions
              found.
            </p>
            <div className="ticks mt-4 h-1.5 rounded-full opacity-60" aria-hidden />
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => {
                  setCelebrating(false);
                  setToolOpen(true);
                  mapRef.current?.setView([player.lat, player.lng], 13);
                }}
                className="rounded-xl bg-primary px-4 py-3 text-[10px] font-bold tracking-[0.22em] text-primary-foreground"
              >
                CHOOSE NEXT DIRECTION
              </button>
              <button
                onClick={() => rollNext()}
                disabled={scouting}
                className="rounded-xl border border-border px-4 py-3 text-[10px] tracking-[0.2em] text-muted-foreground disabled:opacity-60"
              >
                {scouting ? "SCOUTING…" : "SURPRISE ME"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* coordinate console */}
      {!toolOpen && (
        <div className="absolute inset-x-0 bottom-0 z-[500] p-3">
          <div className="panel rounded-2xl p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                Where you are
              </p>
              <p className="text-[11px] tracking-[0.2em] text-accent">SECTOR {pc.sector}</p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <Coord axis="X" value={pc.x} />
              <Coord axis="Z" value={pc.z} />
            </div>

            <div className="ticks mt-4 h-1.5 rounded-full opacity-60" aria-hidden />

            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  The ✕ you&apos;re walking to
                </p>
                <p className="coord-num mt-1 text-sm text-accent">
                  {`X ${group(dc.x)} · Z ${group(dc.z)}`}
                </p>
                <p className="mt-1 text-[9px] tracking-[0.18em] text-muted-foreground">
                  SECTOR {dc.sector}
                </p>
              </div>
              <button
                onClick={end}
                className="shrink-0 rounded-lg border border-border px-3 py-2 text-[10px] tracking-[0.18em] text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive"
              >
                <XIcon className="mr-1 inline h-3 w-3" />
                GIVE UP
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function group(n: number) {
  const s = Math.abs(n).toString();
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009");
  return (n < 0 ? "−" : "") + grouped;
}

function Coord({ axis, value }: { axis: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/70 bg-secondary/40 px-3 py-2">
      <p className="text-[10px] tracking-[0.3em] text-accent">{axis}</p>
      <p className="coord-num mt-0.5 text-[clamp(1.5rem,7vw,2.25rem)] leading-none">
        {group(value)}
      </p>
    </div>
  );
}

function StartScreen({
  onBegin,
  onMultiplayer,
  onFriends,
  loading,
  error,
  level,
}: {
  onBegin: () => void;
  onMultiplayer: () => void;
  onFriends: () => void;
  loading: boolean;
  error: string | null;
  level: number;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

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
        <p className="text-[10px] uppercase tracking-[0.35em] text-accent">Level {level}</p>
        <h1 className="mt-3 text-[1.65rem] font-bold leading-snug">
          There&apos;s a spot near you
          <br />
          you&apos;ve never stood on.
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Your map starts covered in fog. Walking is the only thing that uncovers it — and the mark
          you&apos;re hunting stays hidden until you get close enough to chart it.
        </p>

        <div className="panel mt-7 rounded-2xl p-4">
          <div className="flex items-center justify-between text-[11px] tracking-[0.18em] text-muted-foreground">
            <span>DISTANCE</span>
            <span className="coord-num text-sm text-foreground">2–7 KM</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] tracking-[0.18em] text-muted-foreground">
            <span>DESTINATION</span>
            <span className="coord-num text-sm text-accent">UNKNOWN</span>
          </div>
          <div className="ticks mt-4 h-1.5 rounded-full opacity-60" aria-hidden />
          <button
            onClick={onBegin}
            disabled={loading}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-xs font-bold tracking-[0.22em] text-primary-foreground transition-transform hover:brightness-110 active:translate-y-px disabled:opacity-70"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "FINDING YOU…" : "GIVE ME A PLACE"}
          </button>
          <button
            onClick={onMultiplayer}
            disabled={loading}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-accent/35 px-4 py-3 text-[10px] font-bold tracking-[0.22em] text-accent transition-colors hover:bg-accent/10 disabled:opacity-60"
          >
            <Users className="h-4 w-4" /> MULTIPLAYER HUNT
          </button>
          <button
            onClick={onFriends}
            disabled={loading}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-[10px] font-bold tracking-[0.22em] text-muted-foreground transition-colors hover:border-accent/45 hover:text-accent disabled:opacity-60"
          >
            <UserPlus className="h-4 w-4" /> ADD FRIENDS
          </button>
        </div>

        {error && <p className="mt-4 text-[11px] leading-snug text-destructive">{error}</p>}
        <p className="mt-5 text-[10px] leading-relaxed tracking-wide text-muted-foreground">
          We need your location to drop you on the map. Nothing leaves your phone.
        </p>
        <button
          onClick={handleSignOut}
          className="mt-6 inline-flex items-center gap-1.5 text-[10px] tracking-[0.25em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-3 w-3" /> SIGN OUT
        </button>
      </div>
    </main>
  );
}
