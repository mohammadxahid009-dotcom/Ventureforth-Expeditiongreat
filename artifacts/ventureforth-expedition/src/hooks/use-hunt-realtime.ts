import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { distanceMeters, type LatLng } from "@/lib/expedition";
import { listHuntPlayers, loadHuntRoom, type HuntPlayer, type HuntRoom } from "@/lib/multiplayer";

export type RemoteHuntPlayer = HuntPlayer & {
  location: LatLng | null;
  connected: boolean;
  lastUpdated: number | null;
};

const LOCATION_INTERVAL_MS = 1500;
const LOCATION_MIN_DISTANCE_M = 4;

function validLocation(value: unknown): value is LatLng {
  if (!value || typeof value !== "object") return false;
  const point = value as { lat?: unknown; lng?: unknown };
  return (
    typeof point.lat === "number" &&
    Number.isFinite(point.lat) &&
    typeof point.lng === "number" &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

/**
 * A private Supabase Realtime channel carries ephemeral location data. Durable
 * room/roster data remains in Postgres and is refreshed on database changes.
 */
export function useHuntRealtime(
  initialRoom: HuntRoom | null,
  userId: string | null | undefined,
  localPosition: LatLng | null,
  onRoomChanged?: (room: HuntRoom) => void,
) {
  const [room, setRoom] = useState<HuntRoom | null>(initialRoom);
  const [players, setPlayers] = useState<HuntPlayer[]>([]);
  const [locations, setLocations] = useState<Record<string, { point: LatLng; at: number }>>({});
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastSentRef = useRef<{ point: LatLng; at: number } | null>(null);

  useEffect(() => {
    setRoom(initialRoom);
  }, [initialRoom?.id, initialRoom?.state]);

  useEffect(() => {
    if (!room?.id || !userId) {
      setPlayers([]);
      setLocations({});
      setConnected(new Set());
      return;
    }

    let alive = true;
    const refresh = async () => {
      try {
        const [nextRoom, nextPlayers] = await Promise.all([
          loadHuntRoom(room.id),
          listHuntPlayers(room.id),
        ]);
        if (!alive) return;
        setRoom(nextRoom);
        setPlayers(nextPlayers);
        onRoomChanged?.(nextRoom);
      } catch {
        // A leave/revoke can race a received Realtime event. The UI will
        // disappear through its normal leave flow instead of surfacing noise.
      }
    };

    void refresh();
    const channel = supabase
      .channel(`hunt:${room.id}`, {
        config: {
          private: true,
          broadcast: { self: false },
          presence: { key: userId },
        },
      })
      .on("presence", { event: "sync" }, () => {
        const snapshot = channel.presenceState() as Record<string, Array<{ user_id?: string }>>;
        const next = new Set<string>();
        Object.values(snapshot).forEach((entries) => {
          entries.forEach((entry) => {
            if (entry.user_id) next.add(entry.user_id);
          });
        });
        setConnected(next);
      })
      .on("broadcast", { event: "location" }, ({ payload }) => {
        const message = payload as { userId?: unknown; point?: unknown; at?: unknown };
        if (
          typeof message.userId !== "string" ||
          message.userId === userId ||
          !validLocation(message.point)
        )
          return;
        const senderId = message.userId;
        const senderPoint = message.point;
        setLocations((current) => ({
          ...current,
          [senderId]: {
            point: senderPoint,
            at: typeof message.at === "number" ? message.at : Date.now(),
          },
        }));
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hunt_rooms", filter: `id=eq.${room.id}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hunt_players", filter: `room_id=eq.${room.id}` },
        () => void refresh(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ user_id: userId, online_at: new Date().toISOString() });
        }
      });

    channelRef.current = channel;
    return () => {
      alive = false;
      channelRef.current = null;
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [room?.id, userId, onRoomChanged]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !userId || !localPosition || room?.state !== "active") return;
    const previous = lastSentRef.current;
    const now = Date.now();
    if (
      previous &&
      now - previous.at < LOCATION_INTERVAL_MS &&
      distanceMeters(previous.point, localPosition) < LOCATION_MIN_DISTANCE_M
    ) {
      return;
    }
    lastSentRef.current = { point: localPosition, at: now };
    void channel.send({
      type: "broadcast",
      event: "location",
      payload: { userId, point: localPosition, at: now },
    });
  }, [localPosition?.lat, localPosition?.lng, room?.state, userId]);

  const remotePlayers: RemoteHuntPlayer[] = players
    .filter((player) => player.user_id !== userId)
    .map((player) => ({
      ...player,
      location: locations[player.user_id]?.point ?? null,
      lastUpdated: locations[player.user_id]?.at ?? null,
      connected: connected.has(player.user_id),
    }));

  return { room, players, remotePlayers };
}
