export type LatLng = { lat: number; lng: number };

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function distanceMeters(a: LatLng, b: LatLng) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearingDegrees(a: LatLng, b: LatLng) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function compassLabel(deg: number) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8] ?? "N";
}

export function destinationFrom(origin: LatLng, bearing: number, meters: number): LatLng {
  const br = toRad(bearing);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);
  const dr = meters / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(dr) * Math.cos(lat1),
      Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

/** Pick a fixed random destination 2-7 km away. */
export function rollDestination(origin: LatLng): LatLng {
  const bearing = Math.random() * 360;
  const meters = 2000 + Math.random() * 5000;
  return destinationFrom(origin, bearing, meters);
}

const SECTOR_DEGREES = 0.04;
const COORDS_PER_METRE = 5;
const LAT_METRES_PER_DEGREE = 110540;
const LNG_METRES_PER_DEGREE = 111320;
const LAT_SECTOR_COUNT = Math.ceil(180 / SECTOR_DEGREES);
const LNG_SECTOR_COUNT = Math.ceil(360 / SECTOR_DEGREES);

export type GlobalAddress = {
  sector: string;
  x: number;
  z: number;
};

function sectorIndex(value: number, minimum: number, count: number) {
  return Math.min(count - 1, Math.max(0, Math.floor((value - minimum) / SECTOR_DEGREES)));
}

function encodeSector(row: number, column: number) {
  return `${column.toString(36).toUpperCase().padStart(3, "0")}-${row
    .toString(36)
    .toUpperCase()
    .padStart(3, "0")}`;
}

function decodeSector(sector: string) {
  const match = /^([0-9A-Z]{3})-([0-9A-Z]{3})$/i.exec(sector.trim());
  if (!match?.[1] || !match[2]) return null;
  const column = Number.parseInt(match[1], 36);
  const row = Number.parseInt(match[2], 36);
  if (column >= LNG_SECTOR_COUNT || row >= LAT_SECTOR_COUNT) return null;
  return { row, column };
}

/** A permanent world address. The sector plus X/Z identifies one GPS point
 * for every player; it never depends on where a session began. */
export function globalAddress(p: LatLng): GlobalAddress {
  const row = sectorIndex(p.lat, -90, LAT_SECTOR_COUNT);
  const column = sectorIndex(p.lng, -180, LNG_SECTOR_COUNT);
  const centreLat = -90 + (row + 0.5) * SECTOR_DEGREES;
  const centreLng = -180 + (column + 0.5) * SECTOR_DEGREES;
  const x = Math.round(
    (p.lng - centreLng) * LNG_METRES_PER_DEGREE * Math.cos(toRad(centreLat)) * COORDS_PER_METRE,
  );
  const z = Math.round(-(p.lat - centreLat) * LAT_METRES_PER_DEGREE * COORDS_PER_METRE);
  return { sector: encodeSector(row, column), x, z };
}

/** Resolve a shared sector/X/Z address back to its real-world point. */
export function addressToLatLng(address: GlobalAddress): LatLng | null {
  if (!Number.isFinite(address.x) || !Number.isFinite(address.z)) return null;
  const indices = decodeSector(address.sector);
  if (!indices) return null;
  const centreLat = -90 + (indices.row + 0.5) * SECTOR_DEGREES;
  const centreLng = -180 + (indices.column + 0.5) * SECTOR_DEGREES;
  const lngScale = LNG_METRES_PER_DEGREE * Math.cos(toRad(centreLat)) * COORDS_PER_METRE;
  if (Math.abs(lngScale) < 0.000001) return null;
  const point = {
    lat: centreLat - address.z / (LAT_METRES_PER_DEGREE * COORDS_PER_METRE),
    lng: centreLng + address.x / lngScale,
  };
  if (point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) return null;
  const canonical = globalAddress(point);
  return canonical.sector === encodeSector(indices.row, indices.column) ? point : null;
}

/** Backwards-compatible coordinate helper for the HUD. */
export function gameCoords(p: LatLng) {
  const { x, z } = globalAddress(p);
  return { x, z };
}

export function formatDistance(m: number) {
  return m < 1000 ? `${Math.round(m)} M` : `${(m / 1000).toFixed(2)} KM`;
}

export const ARRIVAL_RADIUS = 40;

/** Human-readable sector code for the fictional grid, e.g. "K-14". */
export function sectorCode(p: LatLng) {
  return globalAddress(p).sector;
}

/** Rough walking time in minutes at ~4.8 km/h. */
export function walkMinutes(meters: number) {
  return Math.max(1, Math.round(meters / 80));
}

/** How much map (in metres) the player reveals around themselves as they walk. */
export const REVEAL_RADIUS = 70;

/** Has this point been uncovered by the player's exploration trail? */
export function isDiscovered(p: LatLng, trail: LatLng[], radius = REVEAL_RADIUS) {
  return trail.some((t) => distanceMeters(t, p) <= radius);
}

export type Cone = {
  /** centre bearing of the cone, degrees from north */
  bearing: number;
  /** half angle of the cone in degrees */
  halfWidth: number;
  /** furthest allowed distance in metres */
  length: number;
};

/** Random point inside a directional cone anchored at the player. */
export function randomPointInCone(origin: LatLng, cone: Cone): LatLng {
  const minM = Math.max(400, cone.length * 0.35);
  const maxM = Math.max(minM + 200, cone.length);
  // sqrt keeps the picks area-uniform instead of clustering near the player
  const meters = Math.sqrt(minM * minM + Math.random() * (maxM * maxM - minM * minM));
  const bearing = cone.bearing + (Math.random() * 2 - 1) * cone.halfWidth;
  return destinationFrom(origin, bearing, meters);
}

const BAD_CLASS = new Set(["water", "waterway", "military", "aeroway", "railway"]);
const BAD_TYPE = new Set([
  "water",
  "bay",
  "strait",
  "sea",
  "ocean",
  "reservoir",
  "river",
  "lake",
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "runway",
  "quarry",
]);

/** Cheap OSM sanity check — rejects water, motorways and restricted land. */
async function looksReachable(p: LatLng): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${p.lat}&lon=${p.lng}`,
      { signal: ctrl.signal, headers: { Accept: "application/json" } },
    );
    clearTimeout(t);
    if (!res.ok) return true;
    const j = (await res.json()) as { class?: string; type?: string; error?: string };
    if (j.error) return false; // nothing mapped here at all — usually open water
    if (j.class && BAD_CLASS.has(j.class)) return false;
    if (j.type && BAD_TYPE.has(j.type)) return false;
    return true;
  } catch {
    return true; // offline / rate-limited: don't block the game
  }
}

/** Pick a random, plausibly reachable destination inside the chosen zone. */
export async function pickDestinationInCone(origin: LatLng, cone: Cone): Promise<LatLng> {
  let first: LatLng | null = null;
  for (let i = 0; i < 5; i++) {
    const cand = randomPointInCone(origin, cone);
    if (!first) first = cand;
    if (await looksReachable(cand)) return cand;
  }
  return first ?? randomPointInCone(origin, cone);
}

export const DEFAULT_CONE: Cone = { bearing: 0, halfWidth: 25, length: 4000 };
