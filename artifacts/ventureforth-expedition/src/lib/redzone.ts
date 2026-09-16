import { useEffect, useRef, useState } from "react";
import {
  bearingDegrees,
  destinationFrom,
  distanceMeters,
  type LatLng,
} from "@/lib/expedition";

export const REDZONE_RADIUS_M = 18;
export const REDZONE_DURATION_MS = 60_000;
export const REDZONE_DISCOVERY_RADIUS_M = 125;
export const REDZONE_TIME_MULTIPLIER = 1.7;

export type Redzone = {
  id: string;
  center: LatLng;
  radius: number;
  expiresAt: number;
};

type RedzoneOptions = {
  active: boolean;
  roomId: string | null;
  userId: string | null | undefined;
  player: LatLng | null;
  destination: LatLng | null;
  heading: number | null;
};

function seededRandom(seed: string) {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function nextDelay(random: () => number) {
  // A quiet cadence keeps Redzones special: roughly 55–95 seconds between attempts.
  return 55_000 + random() * 40_000;
}

function chooseCenter(
  player: LatLng,
  destination: LatLng,
  heading: number | null,
  random: () => number,
) {
  const routeBearing = bearingDegrees(player, destination);
  const forwardBearing =
    heading !== null && Number.isFinite(heading)
      ? routeBearing * 0.72 + heading * 0.28
      : routeBearing;
  const forwardMeters = 55 + random() * 105;
  const lateralMeters = (random() - 0.5) * 70;
  const forward = destinationFrom(player, forwardBearing, forwardMeters);
  return destinationFrom(forward, forwardBearing + 90, lateralMeters);
}

/**
 * A deliberately local hazard loop. It does not add database writes, polling,
 * or Realtime events to a hunt: one interval, one circle, and one penalty
 * accumulator per active player.
 */
export function useRedzone({ active, roomId, userId, player, destination, heading }: RedzoneOptions) {
  const [zone, setZone] = useState<Redzone | null>(null);
  const [discovered, setDiscovered] = useState(false);
  const [penaltyMs, setPenaltyMs] = useState(0);
  const zoneRef = useRef<Redzone | null>(null);
  const discoveredRef = useRef(false);
  const routeRef = useRef({ player, destination, heading });
  const randomRef = useRef<(() => number) | null>(null);
  const nextSpawnAtRef = useRef(0);
  const lastTickAtRef = useRef(0);
  const sequenceRef = useRef(0);
  routeRef.current = { player, destination, heading };

  useEffect(() => {
    if (!active || !roomId || !userId) {
      zoneRef.current = null;
      discoveredRef.current = false;
      setZone(null);
      setDiscovered(false);
      setPenaltyMs(0);
      randomRef.current = null;
      nextSpawnAtRef.current = 0;
      lastTickAtRef.current = 0;
      return;
    }
    const random = seededRandom(`${roomId}:${userId}`);
    randomRef.current = random;
    sequenceRef.current = 0;
    zoneRef.current = null;
    discoveredRef.current = false;
    setZone(null);
    setDiscovered(false);
    setPenaltyMs(0);
    nextSpawnAtRef.current = Date.now() + 18_000 + random() * 18_000;
    lastTickAtRef.current = Date.now();
  }, [active, roomId, userId]);

  useEffect(() => {
    if (!active || !roomId || !userId) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      const random = randomRef.current;
      if (!random) return;

      let current = zoneRef.current;
      if (current && now >= current.expiresAt) {
        current = null;
        zoneRef.current = null;
        discoveredRef.current = false;
        setZone(null);
        setDiscovered(false);
        nextSpawnAtRef.current = now + nextDelay(random);
      }

      const route = routeRef.current;
      if (!current && now >= nextSpawnAtRef.current && route.player && route.destination) {
        // Only create a hazard when there is a live route to place it on.
        sequenceRef.current += 1;
        current = {
          id: `${roomId}:${userId}:${sequenceRef.current}`,
          center: chooseCenter(route.player, route.destination, route.heading, random),
          radius: REDZONE_RADIUS_M,
          expiresAt: now + REDZONE_DURATION_MS,
        };
        zoneRef.current = current;
        setZone(current);
        nextSpawnAtRef.current = now + nextDelay(random);
        lastTickAtRef.current = now;
      }

      if (!current) {
        lastTickAtRef.current = now;
        return;
      }

      const distance = route.player ? distanceMeters(route.player, current.center) : Infinity;
      if (!discoveredRef.current && distance <= REDZONE_DISCOVERY_RADIUS_M) {
        discoveredRef.current = true;
        setDiscovered(true);
      }
      if (distance <= current.radius) {
        const elapsed = Math.max(0, now - lastTickAtRef.current);
        if (elapsed > 0) {
          setPenaltyMs((value) => value + elapsed * (REDZONE_TIME_MULTIPLIER - 1));
        }
      }
      lastTickAtRef.current = now;
    }, 1000);
    return () => window.clearInterval(interval);
  }, [active, roomId, userId]);

  const inside = Boolean(
    zone && player && distanceMeters(player, zone.center) <= zone.radius,
  );
  return { zone, discovered, inside, penaltyMs };
}