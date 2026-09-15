import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import type { LatLng } from "@/lib/expedition";

export type HuntMode = "team" | "vs";
export type HuntState = "waiting" | "active" | "finished" | "cancelled";
export type HuntRoom = Tables<"hunt_rooms">;
export type HuntPlayer = Tables<"hunt_players">;

export function playerName(user: User) {
  const candidate =
    user.user_metadata?.["display_name"] ??
    user.user_metadata?.["full_name"] ??
    user.email?.split("@")[0] ??
    "Explorer";
  return String(candidate).trim().slice(0, 32) || "Explorer";
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function createHuntRoom(mode: HuntMode, user: User) {
  const { data, error } = await supabase.rpc("create_hunt_room", {
    p_mode: mode,
    p_display_name: playerName(user),
  });
  throwIfError(error);
  return data as HuntRoom;
}

export async function joinHuntRoom(code: string, user: User) {
  const { data, error } = await supabase.rpc("join_hunt_room", {
    p_code: code.replace(/[^a-z0-9]/gi, "").toUpperCase(),
    p_display_name: playerName(user),
  });
  throwIfError(error);
  return data as HuntRoom;
}

export async function loadHuntRoom(roomId: string) {
  const { data, error } = await supabase.from("hunt_rooms").select("*").eq("id", roomId).single();
  throwIfError(error);
  return data as HuntRoom;
}

export async function listHuntPlayers(roomId: string) {
  const { data, error } = await supabase
    .from("hunt_players")
    .select("*")
    .eq("room_id", roomId)
    .neq("status", "left")
    .order("joined_at");
  throwIfError(error);
  return (data ?? []) as HuntPlayer[];
}

export const MIN_TIME_LIMIT_MINUTES = 5;
export const MAX_TIME_LIMIT_MINUTES = 180;

export function formatTimeLimit(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} MIN`;
  return m ? `${h} H ${m} MIN` : `${h} H`;
}

/** mm:ss (or h:mm:ss) countdown text for a remaining millisecond amount. */
export function formatCountdown(msLeft: number) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export async function startHunt(roomId: string, timeLimitMinutes: number | null = null) {
  const { data, error } = await supabase.rpc(
    "start_hunt_room_timed",
    timeLimitMinutes === null
      ? { p_room_id: roomId }
      : { p_room_id: roomId, p_time_limit_minutes: timeLimitMinutes },
  );
  throwIfError(error);
  return data as HuntRoom;
}

export async function expireHunt(roomId: string) {
  const { data, error } = await supabase.rpc("expire_hunt_room", { p_room_id: roomId });
  throwIfError(error);
  return data as HuntRoom;
}

export async function leaveHunt(roomId: string) {
  const { error } = await supabase.rpc("leave_hunt_room", { p_room_id: roomId });
  throwIfError(error);
}

export async function assignHuntTarget(roomId: string, destination: LatLng) {
  const { error } = await supabase.rpc("set_hunt_target", {
    p_room_id: roomId,
    p_destination: destination as unknown as Json,
  });
  throwIfError(error);
}

export async function completeHuntTarget(roomId: string) {
  const { error } = await supabase.rpc("complete_hunt_target", { p_room_id: roomId });
  throwIfError(error);
}

export async function loadMyHuntTarget(roomId: string, userId: string): Promise<LatLng | null> {
  const { data, error } = await supabase
    .from("hunt_targets")
    .select("destination")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  const point = data?.destination;
  if (
    point &&
    typeof point === "object" &&
    !Array.isArray(point) &&
    typeof (point as { lat?: unknown }).lat === "number" &&
    typeof (point as { lng?: unknown }).lng === "number"
  ) {
    return point as unknown as LatLng;
  }
  return null;
}
