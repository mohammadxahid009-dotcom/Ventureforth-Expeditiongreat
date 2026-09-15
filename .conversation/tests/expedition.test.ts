import { describe, expect, test } from "bun:test";
import { addressToLatLng, destinationFrom, globalAddress } from "../src/lib/expedition";

const HOME = { lat: 28.6139, lng: 77.209 };

describe("global expedition addresses", () => {
  test("the same real point always has the same address", () => {
    expect(globalAddress(HOME)).toEqual(globalAddress({ ...HOME }));
  });

  test("an address resolves back to its real point", () => {
    const decoded = addressToLatLng(globalAddress(HOME));
    expect(decoded).not.toBeNull();
    expect(Math.abs((decoded?.lat ?? 0) - HOME.lat)).toBeLessThan(0.000003);
    expect(Math.abs((decoded?.lng ?? 0) - HOME.lng)).toBeLessThan(0.000003);
  });

  test("east-west movement changes only X inside a sector", () => {
    const start = globalAddress(HOME);
    const east = globalAddress(destinationFrom(HOME, 90, 10));
    expect(east.sector).toBe(start.sector);
    expect(east.x).not.toBe(start.x);
    expect(east.z).toBe(start.z);
  });

  test("north-south movement changes only Z inside a sector", () => {
    const start = globalAddress(HOME);
    const north = globalAddress({ lat: HOME.lat + 10 / 110540, lng: HOME.lng });
    expect(north.sector).toBe(start.sector);
    expect(north.x).toBe(start.x);
    expect(north.z).not.toBe(start.z);
  });

  test("nearby players do not receive personal zero points", () => {
    expect(globalAddress(destinationFrom(HOME, 45, 1000))).not.toEqual(globalAddress(HOME));
  });

  test("crossing a boundary changes the sector", () => {
    const west = globalAddress({ lat: 10.01, lng: 20.03999 });
    const east = globalAddress({ lat: 10.01, lng: 20.04001 });
    expect(east.sector).not.toBe(west.sector);
  });

  test("malformed and out-of-sector addresses are rejected", () => {
    expect(addressToLatLng({ sector: "INVALID", x: 0, z: 0 })).toBeNull();
    expect(addressToLatLng({ ...globalAddress(HOME), x: 999999 })).toBeNull();
  });
});
